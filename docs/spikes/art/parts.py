import sys, json, base64, io
sys.path.insert(0, sys.argv[1])
import numpy as np
from PIL import Image, ImageFilter
from cartoon import Cartoon, WHITE
W, H, S = 1260, 300, 6
E, R, P = Cartoon.ellipse_pts, Cartoon.rrect_pts, Cartoon.place
FUR, FUR_D, DARK, LIGHT, LIGHT_D = '#8f98a8', '#727b8c', '#2f3340', '#f1f1ec', '#d5d8d6'
RED, RED_D = '#d9483b', '#b0352b'
A = lambda p: np.array(p, np.float32)
def sheet(seed):
    c = Cartoon(W, H, seed=seed, boil=2.0, rough=False)
    parts = {}
    def part(name, cx, cy, hw, hh, shapes):
        m = np.zeros((H, W), np.float32)
        for s in shapes: m = np.maximum(m, np.asarray(c.mask(s), np.float32))
        parts[name] = (cx, cy, hw, hh, m)
    # head, facing +x
    hx, hy = 140, 150
    q = lambda x, y: (hx + x * S, hy + y * S)
    sh = []
    for sy in (-1, 1):
        ear = E(*q(-5, sy * 11), 5.8 * S, 5.8 * S); sh.append(ear)
        c.shape(ear, FUR, shade=(FUR_D, 4, 4), width=8)
        c.shade(E(*q(-5, sy * 11), 2.9 * S, 2.9 * S), DARK, None)
    head = E(hx, hy, 12.5 * S, 13 * S); sh.append(head)
    Fh = c.fill(head, FUR); c.shade(head, FUR_D, (-7, 8), clip=Fh)
    c.shade(A([q(-9, 0), q(-1, -2.4), q(2.5, 0), q(-1, 2.4)]), '#bfc6d1', None, clip=Fh)
    for sy in (-1, 1): c.shade(E(*q(3.6, sy * 6.8), 5.4 * S, 5.7 * S), DARK, None, clip=Fh)
    c.outline(head, 8)
    sn = E(*q(10.5, 0), 8.6 * S, 6.6 * S); sh.append(sn)
    Fs = c.fill(sn, LIGHT); c.shade(sn, LIGHT_D, (-5, 6), clip=Fs); c.outline(sn, 7)
    c.shade(E(*q(16.2, 0), 2.7 * S, 2.9 * S), '#14161c', None)
    for sy in (-1, 1):
        eye = E(*q(4.4, sy * 6.8), 3.5 * S, 3.5 * S); c.shade(eye, WHITE, None); c.outline(eye, 3.5, 0.2)
    part('head', hx, hy, 130, 122, sh)
    # body capsule, 49 long x 27 wide, facing +x
    bx, by = 440, 150
    body = R(bx - 24.5 * S, by - 13.5 * S, bx + 24.5 * S, by + 13.5 * S, 13.5 * S - 2)
    Fb = c.fill(body, FUR); c.shade(body, FUR_D, (-8, 10), clip=Fb)
    c.shade(R(bx - 20 * S, by - 4 * S, bx + 16 * S, by + 4 * S, 4 * S - 1), '#7a8393', None, clip=Fb)
    c.outline(body, 8)
    part('body', bx, by, 165, 98, [body])
    # tail beads
    for name, x, col, shd in (('bead', 690, FUR, FUR_D), ('ring', 800, DARK, '#1f222c')):
        b = E(x, 100, 6.2 * S, 6.6 * S)
        c.shape(b, col, shade=(shd, -4, 5), width=7)
        part(name, x, 100, 52, 54, [b])
    # paw, toes toward +x
    px, py = 910, 100
    palm = E(px, py, 4.9 * S, 4.6 * S); sh = [palm]
    for k in (-1, 0, 1):
        t = E(px + 4.6 * S, py + k * 3.0 * S, 1.9 * S, 1.7 * S); sh.append(t); c.shape(t, DARK, width=5)
    c.shape(palm, DARK, width=6)
    part('paw', px, py, 52, 44, sh)
    # neckerchief: band across the neck, point trailing toward -x
    kx, ky = 1100, 150
    tri = A([(kx, ky - 11 * S), (kx + 3 * S, ky), (kx, ky + 11 * S), (kx - 15 * S, ky + 1 * S)])
    c.shape(tri, RED, shade=(RED_D, -5, 7), width=7)
    band = R(kx - 3 * S, ky - 12.5 * S, kx + 4 * S, ky + 12.5 * S, 3 * S)
    c.shape(band, RED, shade=(RED_D, -3, 5), width=7)
    part('scarf', kx - 5 * S, ky, 100, 95, [tri, band])
    buf = io.BytesIO(); c.save('/dev/null') if False else None
    import tempfile, os
    tmp = tempfile.mktemp(suffix='.png'); c.save(tmp); rgb = np.asarray(Image.open(tmp).convert('RGB')); os.remove(tmp)
    alpha = np.zeros((H, W), np.float32)
    for v in parts.values(): alpha = np.maximum(alpha, v[4])
    a = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(1.2))
    img = Image.fromarray(rgb).convert('RGBA'); img.putalpha(a)
    return img.resize((W // 2, H // 2), Image.LANCZOS), {k: v[:4] for k, v in parts.items()}
out = {}
frames = []
for i, seed in enumerate((3, 14, 27)):
    img, parts = sheet(seed)
    img.save(f'sheet{i}.png', optimize=True)
    frames.append('data:image/png;base64,' + base64.b64encode(open(f'sheet{i}.png', 'rb').read()).decode())
meta = {k: dict(x=(cx - hw) // 2, y=(cy - hh) // 2, w=hw, h=hh, ox=hw / 6, oy=hh / 6) for k, (cx, cy, hw, hh) in parts.items()}
json.dump(dict(frames=frames, parts=meta), open('sprites.json', 'w'))
print({k: v for k, v in meta.items()}, [len(f) // 1024 for f in frames])
