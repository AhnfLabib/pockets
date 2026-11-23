#!/usr/bin/env python3
"""Renders the heist stills natively in three layouts (Heist-Portrait 1080x1920, Heist-Square 1080x1080,
Heist-Landscape 1920x1080) at frames chosen from the beat timeline, and saves them as RGB PNGs in out/heist/stills/."""
import json, os, subprocess
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ev = json.load(open(os.path.join(ROOT, "out/heist/events.json")))
B = {b["i"]: b["frame"] for b in json.load(open(os.path.join(ROOT, "src/heist/beats.json")))["beats"]}
sc = ev["scenes"]
STILLS = {
    "1-spotlight-47-tabs": B[sc["spotlight"]["fromBeat"] + 2] + 8,      # the tab bar, Pockets under YouTube, both rows in
    "2-warning-countdown": B[ev["steal"] - 5] + 6,                      # the giant 5 with the card reading "Mine in 5..."
    "3-steal-then-its-his": B[ev["steal"] + 1] + 8,                     # tab in his mouth, both rows in
    "4-end-card": B[ev["endcard"] + 4] + 14,                            # every end-card element in, before the final hit
    "5-target-tab": B[sc["whip"]["fromBeat"] + 1] + 10,                 # the tab bar close, YouTube glowing: "is mine."
}
tmp = os.path.join(ROOT, "out/heist/frames-stills")
out = os.path.join(ROOT, "out/heist/stills")
os.makedirs(out, exist_ok=True)
for comp, tag in (("Heist-Portrait", "portrait"), ("Heist-Square", "square"), ("Heist-Landscape", "landscape")):
    lst = ",".join(f"{k}-{tag}:{f}" for k, f in STILLS.items())
    subprocess.run(["node", "scripts/heist-frames.mjs", comp, tmp, lst], cwd=ROOT, check=True)
    for k in STILLS:
        im = Image.open(os.path.join(tmp, f"{k}-{tag}.png")).convert("RGB")
        im.save(os.path.join(out, f"{k}-{tag}.png"))
        print(k, tag, im.size, im.mode, "frame", STILLS[k])
