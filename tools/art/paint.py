"""Paint Pockets' body parts and icons.

    python3 -I tools/art/paint.py

Writes assets/sprites/sheet-{0,1,2}.png, assets/sprites/sprites.json and assets/icons/icon-{16,32,48,128}.png.
Started from docs/spikes/art/parts.py and docs/spikes/art/icons2.py (direction B, `mask`).

Every part faces +x. Parts are painted at S paint pixels per display pixel, and the sheets are written at half
that (SCALE sheet pixels per display pixel). Each sheet is painted with a different seed, so the brush lines boil.

Fringe removal (spec fault 3): the painting sits on cream paper. A part's alpha is its shape mask grown by half
the ink width, and every pixel outside the ungrown mask is recoloured to ink before alpha is applied, so the only
thing that can show at a part's edge is ink. The masks are pushed through the same boil displacement as the ink
lines, so the cut follows each sheet's re-traced outline rather than the un-boiled shape.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'vendor'))          # -I drops the script directory from sys.path

import numpy as np                                         # noqa: E402
from PIL import Image, ImageDraw                           # noqa: E402
from cartoon import Cartoon, WHITE, INK, _dilate, hexc     # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
SPRITES = os.path.join(ROOT, 'assets', 'sprites')
ICONS = os.path.join(ROOT, 'assets', 'icons')

S = 6                       # paint pixels per display pixel
SCALE = 3                   # sheet pixels per display pixel (the sheets are the painting at half size)
SEEDS = (3, 14, 27)
HALF_INK = 4                # half the outline width, paint px: how far the alpha reaches past a shape
GUTTER = 8                  # clear paint px inside each crop, beyond the alpha (rotated drawImage samples them)
BOIL = 2.0

E, R = Cartoon.ellipse_pts, Cartoon.rrect_pts
FUR, FUR_D, DARK, LIGHT, LIGHT_D = '#8f98a8', '#727b8c', '#2f3340', '#f1f1ec', '#d5d8d6'
LEG, LEG_D = '#757e8f', '#5f6777'          # lower legs a shade darker, as on a real raccoon
RED, RED_D, NOSE, STRIPE, MASK_D = '#d9483b', '#b0352b', '#14161c', '#bfc6d1', '#22252f'
A = lambda p: np.array(p, np.float32)

# Head geometry in display px, head origin = centre of the skull ellipse. The renderer draws pupils and the blink
# in code over the head, so it needs these (see tools/art/README.md).
EYE_X, EYE_Y, EYE_R = 1.4, 7.0, 4.8        # eye whites at (EYE_X, +-EYE_Y), radius EYE_R
TAIL_LEN = 56
LEG_LEN = 10.5                             # joint centre to joint centre, both leg pieces


def tail_halfwidth(u):
    """tail half-width (display px) at distance u from the base, 0 <= u <= TAIL_LEN"""
    u = np.asarray(u, np.float32)
    body = np.interp(u, [0, 6, 16, 30, 42, 50], [5.6, 6.7, 7.0, 6.2, 5.2, 4.3])
    tip = 4.3 * np.sqrt(np.clip(1 - ((u - 50) / (TAIL_LEN - 50)) ** 2, 0, 1))
    return np.where(u <= 50, body, tip)


# ---------------------------------------------------------------- the parts, each drawn about its origin (px, py)
def head(c, px, py):
    q = lambda x, y: (px + x * S, py + y * S)
    sh = []
    for sy in (-1, 1):
        ear = E(*q(-5, sy * 11), 5.5 * S, 5.5 * S); sh.append(ear)
        c.shape(ear, FUR, shade=(FUR_D, 4, 4), width=8)
        c.shade(E(*q(-5, sy * 11), 2.8 * S, 2.8 * S), DARK, None)
    skull = E(px, py, 12.5 * S, 13 * S); sh.append(skull)
    Fh = c.fill(skull, FUR); c.shade(skull, FUR_D, (-7, 8), clip=Fh)
    c.shade(A([q(-9, 0), q(-1, -2.2), q(2.5, 0), q(-1, 2.2)]), STRIPE, None, clip=Fh)
    # the bandit mask (spec fault 4): two broad patches sweeping back to the skull outline, clipped to it
    for sy in (-1, 1):
        patch = E(*q(1.2, sy * 7.4), 8.0 * S, 6.6 * S, rot=-sy * 14)
        c.shade(patch, DARK, None, clip=Fh)
        c.shade(patch, MASK_D, (4, 6), clip=Fh)
    c.outline(skull, 8)
    sn = E(*q(11.2, 0), 8.4 * S, 5.6 * S); sh.append(sn)      # a little slimmer than the spike's, to clear the eyes
    Fs = c.fill(sn, LIGHT); c.shade(sn, LIGHT_D, (-5, 6), clip=Fs); c.outline(sn, 7)
    c.shade(E(*q(16.9, 0), 2.6 * S, 2.8 * S), NOSE, None)
    for sy in (-1, 1):                      # eye whites as large as the skull allows; pupils come from code
        eye = E(*q(EYE_X, sy * EYE_Y), EYE_R * S, EYE_R * S)
        c.shade(eye, WHITE, None); c.outline(eye, 4.5, 0.2)
    return sh


def body(c, px, py):
    b = R(px - 24.5 * S, py - 13.5 * S, px + 24.5 * S, py + 13.5 * S, 13.5 * S - 2)
    Fb = c.fill(b, FUR); c.shade(b, FUR_D, (-8, 10), clip=Fb)
    c.shade(R(px - 20 * S, py - 4 * S, px + 16 * S, py + 4 * S, 4 * S - 1), '#7a8393', None, clip=Fb)
    c.outline(b, 8)
    return [b]


def tail(c, px, py):
    """one straight tapering ringed tail: base at the origin, tip TAIL_LEN display px away along -x (spec fault 1)"""
    u = np.linspace(0, TAIL_LEN, 140)
    hw = tail_halfwidth(u)
    top = np.stack([px - u * S, py - hw * S], 1)
    bot = np.stack([px - u * S, py + hw * S], 1)[::-1]
    base = E(px, py, 1.2 * S, 5.6 * S, a0=90, a1=-90, n=24)[1:-1]     # a slightly rounded base, under the body
    outline = np.concatenate([top, bot, base[::-1]]).astype(np.float32)
    Ft = c.fill(outline, FUR)
    c.shade(outline, FUR_D, (3, 8), clip=Ft)
    rings = np.zeros((c.H, c.W), np.float32)
    for u0, u1 in ((7, 11.5), (17, 21.5), (27, 31), (36.5, 40), (45, 48)):    # dark rings, then a dark tip
        bow = 0.8                                                             # rings wrap round: bowed, not flat
        v = np.linspace(-8, 8, 17)
        e0 = np.stack([px - (u0 - bow * (1 - (v / 8) ** 2)) * S, py + v * S], 1)
        e1 = np.stack([px - (u1 - bow * (1 - (v / 8) ** 2)) * S, py + v * S], 1)[::-1]
        rings = np.maximum(rings, c.mask(np.concatenate([e0, e1])))
    v = np.linspace(-8, 8, 17)
    tipb = np.stack([px - (53 - 0.8 * (1 - (v / 8) ** 2)) * S, py + v * S], 1)
    rings = np.maximum(rings, c.mask(np.concatenate([tipb, [(px - 70 * S, py + 8 * S), (px - 70 * S, py - 8 * S)]])))
    clip = np.minimum(rings, c._full(Ft))
    c.shade(clip, DARK, None)
    c.shade(clip, '#1f222c', (3, 7), clip=clip)
    c.outline(outline, 8, smooth=False)
    return [outline]


def leg_piece(c, px, py, w0, w1, colour, shade):
    """a tapering painted limb segment from a joint at the origin to the next joint LEG_LEN along +x (spec fault 2)"""
    x1 = px + LEG_LEN * S
    top = [(px, py - w0 * S), (x1, py - w1 * S)]
    a = E(x1, py, w1 * S, w1 * S, a0=-90, a1=90, n=30)
    b = E(px, py, w0 * S, w0 * S, a0=90, a1=270, n=30)
    pts = A(Cartoon.densify(A([top[0], top[1]]), 6, closed=False).tolist() + a.tolist()
            + Cartoon.densify(A([(x1, py + w1 * S), (px, py + w0 * S)]), 6, closed=False).tolist() + b.tolist())
    c.shape(pts, colour, shade=(shade, -3, 6), width=7)
    return [pts]


def leg_upper(c, px, py):
    return leg_piece(c, px, py, 4.2, 3.7, FUR, FUR_D)


def leg_lower(c, px, py):
    return leg_piece(c, px, py, 3.7, 3.2, LEG, LEG_D)


def paw(c, px, py):
    palm = E(px, py, 4.9 * S, 4.6 * S); sh = [palm]
    for k in (-1, 0, 1):
        t = E(px + 4.6 * S, py + k * 3.0 * S, 1.9 * S, 1.7 * S); sh.append(t); c.shape(t, DARK, width=5)
    c.shape(palm, DARK, width=6)
    return sh


def scarf(c, px, py):
    """neckerchief: a band across the neck at the origin, its point trailing toward -x"""
    tri = A([(px, py - 11 * S), (px + 3 * S, py), (px, py + 11 * S), (px - 15 * S, py + 1 * S)])
    c.shape(tri, RED, shade=(RED_D, -5, 7), width=7)
    band = R(px - 3 * S, py - 12.5 * S, px + 4 * S, py + 12.5 * S, 3 * S)
    c.shape(band, RED, shade=(RED_D, -3, 5), width=7)
    return [tri, band]


# name, painter, bounding box about the origin in display px (x0, y0, x1, y1), and the part's main colour, which
# replaces the cream paper under it (so a fill painted a little off its line shows that colour, not paper)
PARTS = [
    ('head', head, (-13, -17, 20, 17), FUR),
    ('body', body, (-25, -14, 25, 14), FUR),
    ('tail', tail, (-56, -7.5, 1.5, 7.5), FUR),
    ('legUpper', leg_upper, (-4.5, -4.5, 14.5, 4.5), FUR),
    ('legLower', leg_lower, (-4, -4, 14, 4), LEG),
    ('paw', paw, (-5, -6, 7, 6), DARK),
    ('scarf', scarf, (-15.5, -13, 4.5, 13), RED),
]
PAD = HALF_INK + 4 + GUTTER                 # paint px around each box: ink, boil, then clear gutter


def layout():
    """origins (paint px) and crops (paint px, even) for every part, packed left to right in one row"""
    out, x = {}, 0
    hmax = max(b[3] - b[1] for _, _, b, _ in PARTS) * S + 2 * PAD
    H = int(np.ceil(hmax / 2)) * 2
    for name, fn, (x0, y0, x1, y1), base in PARTS:
        w = int(np.ceil(((x1 - x0) * S + 2 * PAD) / 2)) * 2
        h = int(np.ceil(((y1 - y0) * S + 2 * PAD) / 2)) * 2
        cy0 = (H - h) // 2 // 2 * 2
        ox, oy = x + PAD - x0 * S, cy0 + PAD - y0 * S
        out[name] = dict(fn=fn, origin=(ox, oy), crop=(x, cy0, w, h), base=base)
        x += w
    return out, x, H


def sheet(seed, lay, W, H):
    c = Cartoon(W, H, seed=seed, boil=BOIL, rough=False)
    shapes = []
    for name, p in lay.items():
        mine = p['fn'](c, *p['origin'])
        x, y, w, h = p['crop']
        pts = np.concatenate(mine)
        lo, hi = pts.min(0), pts.max(0)
        m = HALF_INK + 4                                    # the alpha may reach this far past the shape
        assert lo[0] - m >= x and lo[1] - m >= y and hi[0] + m <= x + w and hi[1] + m <= y + h, f'{name} overflows its crop'
        shapes += mine
    for p in lay.values():                                  # no cream paper under the parts
        x, y, w, h = p['crop']
        c.paperc[y:y + h, x:x + w] = hexc(p['base'])
    rgb = np.asarray(c.composite(), np.float32) / 255
    m = np.zeros((H, W), np.float32)
    for s in shapes: m = np.maximum(m, c.mask(s))
    if c.boil:                                             # follow the re-traced outline of this sheet
        fx, fy = c._field(0, c.boil)
        m, = c._warp([m], fx, fy)
    inside = m > 0.5
    alpha = _dilate(inside.astype(np.float32), HALF_INK)
    rgb[~inside] = hexc(INK)                               # outside the shape only ink may show: no paper fringe
    return rgb, alpha, inside


def halve(rgb, alpha):
    """downsample to sheet size (premultiplied, so transparent pixels cannot bleed colour)"""
    h, w = alpha.shape
    pre = np.dstack([rgb * alpha[..., None], alpha])
    chans = [Image.fromarray(pre[..., k].astype(np.float32), mode='F').resize((w // 2, h // 2), Image.LANCZOS) for k in range(4)]
    out = np.stack([np.asarray(ch, np.float32) for ch in chans], -1)
    a = np.clip(out[..., 3], 0, 1)
    col = np.where(a[..., None] > 1e-4, out[..., :3] / np.maximum(a, 1e-4)[..., None], hexc(INK))
    out = np.dstack([np.clip(col, 0, 1), a])
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')


def sprites():
    os.makedirs(SPRITES, exist_ok=True)
    lay, W, H = layout()
    for i, seed in enumerate(SEEDS):
        rgb, alpha, _ = sheet(seed, lay, W, H)
        halve(rgb, alpha).save(os.path.join(SPRITES, f'sheet-{i}.png'), optimize=True)
    parts = {}
    for name, p in lay.items():
        x, y, w, h = p['crop']; ox, oy = p['origin']
        parts[name] = dict(x=x // 2, y=y // 2, w=w // 2, h=h // 2,
                           ox=round((ox - x) / S, 4), oy=round((oy - y) / S, 4))
    meta = dict(scale=SCALE, parts=parts)
    with open(os.path.join(SPRITES, 'sprites.json'), 'w') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    return meta


# ---------------------------------------------------------------- icons: direction B (mask)
N = 512
INKK = NOSE
FULL = A([(-20, -20), (N + 20, -20), (N + 20, N + 20), (-20, N + 20)])


def eyes(c, y, dx, r, look, lw, glint=True, pupil=0.58):
    for sx in (-1, 1):
        ex = 256 + sx * dx
        e = E(ex, y, r, r + 2); c.shade(e, WHITE, None); c.outline(e, lw, 0.2)
        c.shade(E(ex + look[0], y + look[1], r * pupil, r * (pupil + .02)), INKK, None)
        if glint: c.shade(E(ex + look[0] + r * .28, y + look[1] - r * .3, r * .2, r * .2), WHITE, None)


def icon_full(c):
    """icons2.mask as chosen: extreme close-up, the bandit mask fills the tile (48 and 128 px)"""
    c.fill(FULL, FUR, slop=0)
    c.shade(A([(256, -20), (196, 120), (256, 176), (316, 120)]), '#c3cad4', None)
    c.shade(E(110, 240, 190, 130, rot=-10), DARK, None); c.shade(E(402, 240, 190, 130, rot=10), DARK, None)
    eyes(c, 236, 118, 76, (10, 14), 8)
    sn = E(256, 470, 150, 120); Fs = c.fill(sn, LIGHT); c.shade(sn, LIGHT_D, (10, 14), clip=Fs); c.outline(sn, 12)
    c.shape(A([(210, 392), (302, 392), (256, 444)]), INKK, width=9)


def icon_small(c, r=82, lw=30, pupil=0.58):
    """the same mark simplified for 16 and 32 px: no shading or stripe, heavier outlines, bigger features"""
    c.fill(FULL, FUR, slop=0)
    c.shade(E(110, 236, 200, 144, rot=-10), DARK, None); c.shade(E(402, 236, 200, 144, rot=10), DARK, None)
    eyes(c, 232, 122, r, (6, 10), lw, glint=False, pupil=pupil)
    sn = E(256, 482, 172, 128); c.fill(sn, LIGHT, slop=0); c.outline(sn, lw + 4, 0.1)
    c.shape(A([(196, 390), (316, 390), (256, 452)]), INKK, width=16, slop=0)


def icon_16(c):
    icon_small(c, r=104, lw=34, pupil=0.48)


def render_icon(fn, seed):
    c = Cartoon(N, N, seed=seed, boil=1.6, rough=False)
    fn(c)
    rgb = np.asarray(c.composite(), np.float32) / 255
    rm = Image.new('L', (N, N), 0); ImageDraw.Draw(rm).rounded_rectangle((0, 0, N - 1, N - 1), 112, fill=255)
    return rgb, np.asarray(rm, np.float32) / 255


def shrink(rgb, alpha, n):
    pre = np.dstack([rgb * alpha[..., None], alpha])
    chans = [Image.fromarray(pre[..., k].astype(np.float32), mode='F').resize((n, n), Image.LANCZOS) for k in range(4)]
    out = np.stack([np.asarray(ch, np.float32) for ch in chans], -1)
    a = np.clip(out[..., 3], 0, 1)
    col = np.where(a[..., None] > 1e-4, out[..., :3] / np.maximum(a, 1e-4)[..., None], 0)
    a = np.where(a < 1 / 255, 0, a)
    return Image.fromarray((np.dstack([np.clip(col, 0, 1), a]) * 255 + 0.5).astype(np.uint8), 'RGBA')


def icons():
    os.makedirs(ICONS, exist_ok=True)
    big = render_icon(icon_full, 12)           # seed 12 = icons2's seed for B
    art = {16: render_icon(icon_16, 12), 32: render_icon(icon_small, 12), 48: big, 128: big}
    for n, im in art.items():
        shrink(*im, n).save(os.path.join(ICONS, f'icon-{n}.png'), optimize=True)


if __name__ == '__main__':
    meta = sprites()
    icons()
    print(json.dumps(meta['parts']))
