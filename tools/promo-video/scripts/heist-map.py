#!/usr/bin/env python3
"""Beat map for the heist cut: out/heist/beat-map.png (onset strength and loudness, the beat grid, phrase accents,
and where every cut, caption change and action hit sits) and out/heist/heist.md (the same events as a table)."""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out/heist")
beats = json.load(open(os.path.join(ROOT, "src/heist/beats.json")))
ev = json.load(open(os.path.join(OUT, "events.json")))
curve = json.load(open(os.path.join(OUT, "curve.json")))
dur = ev["duration"] / 30
RED, INK, DIM, BG = "#d9483b", "#f3f0ea", "#6b7079", "#141518"

t = np.arange(len(curve["onset"])) * curve["dt"]
m = t <= dur + 0.6
fig, axes = plt.subplots(3, 1, figsize=(26, 13), facecolor=BG, gridspec_kw={"height_ratios": [1, 1, 1]})
span = dur / 3 + 0.2
for row, ax in enumerate(axes):
    a, b = row * dur / 3 - 0.1, (row + 1) * dur / 3 + 0.1
    ax.set_facecolor(BG)
    ax.fill_between(t[m], 0, np.array(curve["rms"])[m], color="#3a3d44", lw=0)
    ax.plot(t[m], np.array(curve["onset"])[m], color="#8fa3c4", lw=0.8)
    for bb in beats["beats"]:
        if bb["t"] > dur + 0.05:
            break
        ax.axvline(bb["t"], color=RED if bb["phraseStart"] else DIM, lw=2.2 if bb["phraseStart"] else (0.9 if bb["beatInBar"] == 0 else 0.4), alpha=0.9 if bb["phraseStart"] else 0.6, zorder=1)
        ax.text(bb["t"], -0.06, str(bb["i"]), color=DIM, fontsize=7, ha="center", va="top", clip_on=True)
    lanes = {"cut": 1.10, "caption": 1.32, "hit": 1.56}
    colors = {"cut": INK, "caption": "#8fa3c4", "hit": RED}
    seen = {}
    for e in ev["events"]:
        x = e["frame"] / 30
        if not (a <= x <= b):
            continue
        k = (e["kind"], e["frame"])
        lvl = seen.get(k, 0)
        seen[k] = lvl + 1
        y = lanes[e["kind"]] + lvl * 0.075
        ax.plot([x], [lanes[e["kind"]]], marker="v" if e["kind"] != "hit" else "*", ms=9 if e["kind"] != "hit" else 16, color=colors[e["kind"]], zorder=3)
        ax.text(x + 0.03, y + 0.03, e["what"][:34], color=colors[e["kind"]], fontsize=7.5, rotation=0, va="bottom", clip_on=True)
    ax.axvline(dur, color=INK, lw=2, ls="--")
    ax.set_xlim(a, b)
    ax.set_ylim(-0.12, 1.95)
    ax.set_yticks([])
    ax.tick_params(colors=DIM)
    for s in ax.spines.values():
        s.set_color("#2a2c31")
    ax.set_xticks(np.arange(np.ceil(a), b, 0.5))
    ax.grid(False)
axes[0].set_title(f"Heist-Portrait beat map: {beats['bpm']:.1f} BPM, {beats['phraseBeats']}-beat phrases (red), track offset {beats['offset']:.3f} s; "
                  f"lanes: cuts (white), captions (blue), action hits (red stars); video ends at {dur:.2f} s (dashed)",
                  color=INK, fontsize=13, loc="left")
axes[-1].set_xlabel("video time (s); blue line = onset strength, grey = loudness; numbers = beat index", color=DIM)
plt.subplots_adjust(left=0.02, right=0.99, top=0.95, bottom=0.06, hspace=0.18)
plt.savefig(os.path.join(OUT, "beat-map.png"), dpi=80, facecolor=BG)

lines = ["# Heist-Portrait: beat-synced events", "",
         f"Track: \"Fast Percussion\" by lNPLUSMUSIC (Pixabay). Tempo {beats['bpm']:.2f} BPM (beat {beats['period']*1000:.1f} ms), "
         f"{beats['phraseBeats']}-beat phrases; video starts {beats['offset']:.3f} s into the track. Duration {dur:.2f} s ({ev['duration']} frames at 30 fps), "
         f"ending 0.5 s after the final hit (beat {ev['final']}) with a fade.", "",
         f"Action hits: steal on beat {ev['steal']}, Undo on beat {ev['undo']} (the two strongest adjacent phrase accents mid-story), "
         f"end card on beat {ev['endcard']}, final hit on beat {ev['final']}.", "",
         "| Time (s) | Frame | Beat | Kind | Event |", "|---|---|---|---|---|"]
for e in ev["events"]:
    lines.append(f"| {e['frame']/30:.3f} | {e['frame']} | {e['beat']} | {e['kind']} | {e['what']} |")
lines += ["", "Phrase accents (strength):", ""] + [f"- beat {a['i']}: {a['t']:.3f} s, accent {a['accent']:.2f}" for a in beats["phraseAccents"]]
open(os.path.join(OUT, "heist.md"), "w").write("\n".join(lines) + "\n")
print("wrote beat-map.png and heist.md")
