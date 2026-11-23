#!/usr/bin/env python3
"""Tracks Pockets' head in the heist footage (public/footage/heist) so the spotlight and the tight crops follow him.

His eye whites are the only near-white blobs on the dark-mode page (the page text is #e8ebf0, just below the
threshold), so the head is the centroid of the small bright components below the address bar. The carried tab
label is also white but far larger, so it is left out by size. Writes public/footage/heist/track.json:
{"frames": N, "head": [[x, y] | null, ...]} in CSS px from the mock browser's top left.
  python3 scripts/heist-track.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "public/footage/heist")
m = json.load(open(os.path.join(DIR, "manifest.json")))
dsf = m["dsf"]
top = int(86 * dsf)
head = []
for k in range(m["frames"]):
    a = np.asarray(Image.open(os.path.join(DIR, f"f{k:04d}.png")).convert("L"))[top:int(585 * dsf)]  # below: the notice, whose icon has eyes too
    lab, n = ndimage.label(a > 235)
    pts = []
    if n:
        sizes = ndimage.sum(np.ones_like(a), lab, range(1, n + 1))
        for i, s in enumerate(sizes, 1):
            if 40 * dsf * dsf / 9 <= s <= 900 * dsf * dsf / 9:
                ys, xs = np.where(lab == i)
                pts.append((xs.mean(), ys.mean(), s))
    if pts:
        w = sum(p[2] for p in pts)
        x = sum(p[0] * p[2] for p in pts) / w / dsf
        y = (sum(p[1] * p[2] for p in pts) / w + top) / dsf
        head.append([round(x, 1), round(y, 1)])
    else:
        head.append(None)
json.dump({"frames": m["frames"], "head": head}, open(os.path.join(DIR, "track.json"), "w"))
print("tracked", sum(h is not None for h in head), "of", m["frames"])
for k in range(0, m["frames"], 20):
    print(k, head[k])
