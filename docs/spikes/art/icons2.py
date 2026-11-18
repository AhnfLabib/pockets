import sys, os, tempfile
sys.path.insert(0, sys.argv[1]); out = sys.argv[2]
import numpy as np
from PIL import Image, ImageDraw
from cartoon import Cartoon, WHITE
from core import spline
N = 512
E, R = Cartoon.ellipse_pts, Cartoon.rrect_pts
FUR, FUR_D, DARK, LIGHT, LIGHT_D, INKK = '#8f98a8', '#727b8c', '#2f3340', '#f1f1ec', '#d5d8d6', '#14161c'
RED, RED_D = '#d9483b', '#b0352b'
A = lambda p: np.array(p, np.float32)
FULL = A([(-20, -20), (N + 20, -20), (N + 20, N + 20), (-20, N + 20)])
def eyes(c, y, dx, r, look=(6, 6), lw=5):
    for sx in (-1, 1):
        ex = 256 + sx * dx
        e = E(ex, y, r, r + 2); c.shade(e, WHITE, None); c.outline(e, lw, 0.2)
        c.shade(E(ex + look[0], y + look[1], r * .58, r * .6), INKK, None)
        c.shade(E(ex + look[0] + r * .28, y + look[1] - r * .3, r * .2, r * .2), WHITE, None)
def peek(c):                      # A: peeking over a browser tab, paws on its edge
    c.fill(FULL, '#f3e2b8', slop=0)
    for sx in (-1, 1):
        c.shape(E(256 + sx * 118, 150, 58, 62, rot=sx * 18), FUR, shade=(FUR_D, 6, 6), width=11)
        c.shade(E(256 + sx * 118, 154, 30, 34, rot=sx * 18), DARK, None)
    head = E(256, 262, 178, 146); Fh = c.fill(head, FUR); c.shade(head, FUR_D, (12, 14), clip=Fh)
    c.shade(A([(256, 122), (232, 206), (256, 232), (280, 206)]), '#c3cad4', None, clip=Fh)
    for sx in (-1, 1): c.shade(E(256 + sx * 78, 262, 80, 56, rot=sx * 14), DARK, None, clip=Fh)
    c.outline(head, 12); eyes(c, 258, 74, 36, (0, 12))
    tab = A([(40, 560), (40, 352), (70, 322), (442, 322), (472, 352), (472, 560)])
    Ft = c.fill(tab, '#fbfaf5'); c.shade(tab, '#e4dfd2', (0, 26), clip=Ft); c.outline(tab, 12)
    c.shape(R(92, 392, 150, 450, 12), RED, width=7)
    c.line([(176, 408), (400, 408)], 13, (4, 4)); c.line([(176, 440), (330, 440)], 13, (4, 4))
    for sx in (-1, 1):
        for k in (-1, 0, 1): c.shape(E(256 + sx * 150 + k * 26, 318, 16, 20), DARK, width=6)
        c.shape(E(256 + sx * 150, 334, 44, 30), DARK, width=8)
def mask(c):                      # B: extreme close-up, the bandit mask fills the tile
    c.fill(FULL, FUR, slop=0)
    c.shade(A([(256, -20), (196, 120), (256, 176), (316, 120)]), '#c3cad4', None)
    band = np.concatenate([E(256, 236, 330, 132, a0=180, a1=360), E(256, 236, 330, 150, a0=0, a1=180)])
    c.shade(E(110, 240, 190, 130, rot=-10), DARK, None); c.shade(E(402, 240, 190, 130, rot=10), DARK, None)
    eyes(c, 236, 118, 76, (10, 14), 8)
    sn = E(256, 470, 150, 120); Fs = c.fill(sn, LIGHT); c.shade(sn, LIGHT_D, (10, 14), clip=Fs); c.outline(sn, 12)
    c.shape(A([(210, 392), (302, 392), (256, 444)]), INKK, width=9)
def tail(c):                      # C: the ringed tail, curled
    c.fill(FULL, RED, slop=0)
    t = np.linspace(0, 1, 90); ang = np.deg2rad(-200 + 470 * t); rad = 168 - 104 * t
    cl = np.stack([262 + np.cos(ang) * rad, 268 + np.sin(ang) * rad], 1).astype(np.float32)
    d = np.gradient(cl, axis=0); n = np.stack([-d[:, 1], d[:, 0]], 1); n /= np.linalg.norm(n, axis=1, keepdims=True)
    wd = np.linspace(58, 30, len(cl))[:, None]
    tl = np.concatenate([cl + n * wd, (cl - n * wd)[::-1]])
    Ft = c.fill(tl, FUR); c.shade(tl, FUR_D, (8, 10), clip=Ft)
    for i in range(0, 84, 14):
        j = slice(i, i + 8); c.shade(np.concatenate([cl[j] + n[j] * 80, (cl[j] - n[j] * 80)[::-1]]), DARK, None, clip=Ft)
    c.outline(tl, 12)
def sharp(c):                     # D: angular, more raccoon than bear, small knot instead of big scarf
    c.fill(FULL, '#cfe3dc', slop=0)
    for sx in (-1, 1):
        c.shape(A([(256 + sx * 176, 196), (256 + sx * 150, 52), (256 + sx * 60, 132)]), FUR, shade=(FUR_D, 6, 6), width=11)
        c.shade(A([(256 + sx * 152, 160), (256 + sx * 142, 92), (256 + sx * 96, 134)]), DARK, None)
    pts = [(256, 104), (360, 122), (424, 204), (500, 290), (428, 316), (458, 372), (368, 372), (318, 428), (256, 446)]
    head = A(pts + [(512 - x, y) for x, y in pts[-2:0:-1]])
    Fh = c.fill(head, FUR); c.shade(head, FUR_D, (12, 14), clip=Fh)
    c.shade(A([(256, 108), (228, 200), (256, 236), (284, 200)]), '#c3cad4', None, clip=Fh)
    for sx in (-1, 1):
        c.shade(A([(256 + sx * 22, 236), (256 + sx * 150, 200), (256 + sx * 250, 300), (256 + sx * 150, 340), (256 + sx * 50, 318)]), DARK, None, clip=Fh)
    c.outline(head, 12); eyes(c, 268, 96, 40, (4, 8))
    for sx in (-1, 1): c.line([(256 + sx * 150, 222 ), (256 + sx * 52, 246)], 12, (3, 3))
    sn = A([(256, 300), (322, 340), (300, 410), (256, 436), (212, 410), (190, 340)])
    Fs = c.fill(sn, LIGHT); c.shade(sn, LIGHT_D, (8, 10), clip=Fs); c.outline(sn, 9)
    c.shape(A([(226, 318), (286, 318), (256, 356)]), INKK, width=8)
    c.line([(256, 358), (256, 384), (228, 398)], 7, (2, 8)); c.line([(256, 384), (290, 396)], 7, (2, 8))
    c.shape(A([(196, 452), (316, 452), (256, 512)]), RED, shade=(RED_D, 6, 8), width=10)
names = [('A-peek', peek), ('B-mask', mask), ('C-tail', tail), ('D-sharp', sharp)]
sheet = Image.new('RGB', (4 * 250 + 20, 380), '#eceef2'); d = ImageDraw.Draw(sheet)
d.rectangle((0, 290, sheet.width, 380), fill='#1d2128')
rm = Image.new('L', (N, N), 0); ImageDraw.Draw(rm).rounded_rectangle((0, 0, N - 1, N - 1), 112, fill=255)
for i, (nm, fn) in enumerate(names):
    c = Cartoon(N, N, seed=11 + i, boil=1.6, rough=False); fn(c)
    tmp = tempfile.mktemp(suffix='.png'); c.save(tmp); im = Image.open(tmp).convert('RGBA'); os.remove(tmp); im.putalpha(rm)
    im.save(f'{out}/{nm}.png'); x = 20 + i * 250
    b = im.resize((200, 200), Image.LANCZOS); sheet.paste(b, (x, 16), b)
    d.text((x, 224), nm, fill='#1c2230')
    for n, xx, yy in ((48, x, 238), (32, x + 60, 246), (16, x + 104, 254), (32, x, 316), (16, x + 44, 324)):
        s = im.resize((n, n), Image.LANCZOS); sheet.paste(s, (xx, yy), s)
    z = im.resize((16, 16), Image.LANCZOS).resize((64, 64), Image.NEAREST); sheet.paste(z, (x + 130, 232 + 70), z)
sheet.save(f'{out}/icon-options.png'); print('ok')
