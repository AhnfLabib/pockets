import sys
sys.path.insert(0, sys.argv[1])
import numpy as np
from cartoon import Cartoon, WHITE
from core import spline
W = H = 1200
c = Cartoon(W, H, seed=7, boil=2.0)
E, R, P = Cartoon.ellipse_pts, Cartoon.rrect_pts, Cartoon.place
FUR, FUR_D, DARK, LIGHT, LIGHT_D = '#8f98a8', '#727b8c', '#2f3340', '#f1f1ec', '#d5d8d6'
RED, RED_D, PINK = '#d9483b', '#b0352b', '#e9a39c'
A = lambda p: np.array(p, np.float32)

# ground shadow
c.shade(E(600, 1062, 330, 34), '#e2d8c4', None)
c.hatch(E(610, 1066, 290, 22), angle=-60, spacing=13, width=2.6)

# tail: a fat band along a curve, ringed
cl = A(spline(A([(720, 960), (880, 990), (1010, 900), (1040, 740), (980, 620)]), 60))
d = np.gradient(cl, axis=0); n = np.stack([-d[:, 1], d[:, 0]], 1); n /= np.linalg.norm(n, axis=1, keepdims=True)
wd = np.linspace(62, 40, len(cl))[:, None]
tail = np.concatenate([cl + n * wd, (cl - n * wd)[::-1]])
Ft = c.fill(tail, FUR)
N = len(cl); step = N // 6
for i in range(step // 2, N - step // 2, step):
    j = slice(i, i + step // 2 + 1)
    band = np.concatenate([cl[j] + n[j] * 90, (cl[j] - n[j] * 90)[::-1]])
    c.shade(band, DARK, None, clip=Ft)
c.shade(E(985, 610, 70, 60), DARK, None, clip=Ft)
c.outline(tail, 7.5)

# feet
for sx in (-1, 1):
    c.shape(E(600 + sx * 120, 1020, 86, 46, rot=sx * -8), DARK, width=7)
# body
body = E(600, 820, 205, 235)
Fb = c.fill(body, FUR)
c.shade(body, FUR_D, (18, 16), clip=Fb)
c.shade(E(600, 870, 122, 160), LIGHT, None, clip=Fb)
c.outline(body, 8)

# ears (behind head)
for sx in (-1, 1):
    c.shape(E(600 + sx * 168, 270, 78, 84, rot=sx * 20), FUR, shade=(FUR_D, 10, 10), width=7.5)
    c.shade(E(600 + sx * 168, 276, 44, 50, rot=sx * 20), DARK, None)
# cheek tufts
for sx in (-1, 1):
    tuft = A([(600 + sx * 200, 420), (600 + sx * 300, 470), (600 + sx * 236, 498), (600 + sx * 286, 566), (600 + sx * 190, 566)])
    c.shape(tuft, FUR, width=7.5)
# head
head = E(600, 440, 236, 190)
Fh = c.fill(head, FUR)
c.shade(head, FUR_D, (16, 18), clip=Fh)
c.shade(A([(600, 252), (566, 372), (600, 408), (634, 372)]), '#bfc6d1', None, clip=Fh)
for sx in (-1, 1):
    c.shade(E(600 + sx * 100, 442, 102, 72, rot=sx * 14), DARK, None, clip=Fh)
c.outline(head, 8)
# eyes
for sx in (-1, 1):
    eye = E(600 + sx * 92, 440, 46, 48)
    c.shade(eye, WHITE, None); c.outline(eye, 4.5, 0.2)
    c.shade(E(600 + sx * 92 + 9, 449, 27, 28), '#14161c', None)
    c.shade(E(600 + sx * 92 + 19, 437, 9, 9), WHITE, None)
    # smug half lid
    c.line([(600 + sx * 92 - 52, 410 - sx * 8), (600 + sx * 92, 402), (600 + sx * 92 + 52, 410 + sx * 8)], 9, (4, 4))
# snout
snout = E(600, 548, 98, 72)
Fs = c.fill(snout, LIGHT)
c.shade(snout, LIGHT_D, (10, 12), clip=Fs)
c.outline(snout, 6)
c.shape(A([(566, 506), (634, 506), (600, 546)]), '#14161c', width=6)
c.line([(600, 548), (598, 578), (568, 592), (548, 584)], 5.5, (2, 8))
c.line([(600, 578), (640, 594), (668, 572)], 5.5, (2, 8))
c.blush(452, 520, 30, 16); c.blush(748, 520, 30, 16)

# neckerchief
ker = A([(430, 620), (770, 620), (700, 690), (600, 770), (500, 690)])
c.shape(ker, RED, shade=(RED_D, 12, 14), width=7.5)
c.shape(E(712, 650, 30, 24), RED, shade=(RED_D, 5, 6), width=6)
c.shape(A([(730, 660), (800, 700), (760, 724), (716, 676)]), RED, shade=(RED_D, 6, 8), width=6)

# the stolen tab, held in both paws
tab = P(R(-170, -52, 170, 52, 22), 600, 880, 1.0, -6)
Fc = c.fill(tab, '#fbfaf5')
c.shade(tab, '#e1ddd0', (10, 10), clip=Fc)
c.outline(tab, 7)
c.shape(P(R(-140, -26, -88, 26, 8), 600, 880, 1.0, -6), RED, width=4.5)
try: c.note('YouTube', 540, 898, 42, rot=-6)
except Exception as e: print('note failed', e)
for sx in (-1, 1):
    c.shape(E(600 + sx * 176, 884 - sx * 16, 44, 52, rot=sx * 12), DARK, width=7)
c.sparkle(330, 250, 30); c.sparkle(900, 330, 22)
c.save(sys.argv[2])
print('saved')
