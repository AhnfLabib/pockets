#!/usr/bin/env python3
"""Checks the heist cut's sync.
1. Every event in out/heist/events.json (cuts, caption changes, action hits) sits on a beat of src/heist/beats.json:
   asserts the event frame is within 1 frame of the beat's exact time * 30, and prints the max offset in frames.
2. Independently, on the rendered mp4 (if given): hard cuts found by ffmpeg's scene detector are matched to the
   nearest beat, and onsets re-detected from the mp4's own audio are matched to the phrase accents, so the picture,
   the muxed music and the analysis are checked against each other, not just against the timeline file.
3. Per event, on the mp4's picture: the frame-to-frame change is measured around every planned event (cuts, caption
   rows, countdown digits, action hits) and the frame where the change sets in (largest rise within +-3 frames) is taken as
   where the event actually happened; its offset from the beat's exact time is reported (max per file).
  python3 scripts/heist-sync.py out/heist/pockets-heist-portrait.mp4
"""
import json, os, re, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
beats = json.load(open(os.path.join(ROOT, "src/heist/beats.json")))
ev = json.load(open(os.path.join(ROOT, "out/heist/events.json")))
FPS = 30
bt = np.array([b["t"] for b in beats["beats"]])
period = beats["period"]


def beat_time(i):
    return bt[i] if i < len(bt) else bt[0] + i * period


worst = 0.0
for e in ev["events"]:
    off = abs(e["frame"] - beat_time(e["beat"]) * FPS)
    # Also against the nearest beat at all, in case a beat index is wrong.
    near = np.min(np.abs(bt * FPS - e["frame"]))
    assert off <= 1.0 and near <= 1.0, f"off-beat event: {e} (offset {off:.2f} frames)"
    worst = max(worst, off)
print(f"[timeline] {len(ev['events'])} events, all on beats; max offset {worst:.2f} frames")

if len(sys.argv) > 1:
    mp4 = sys.argv[1]
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", mp4, "-vf", "select='gt(scene,0.10)',showinfo", "-an", "-f", "null", "-"], capture_output=True, text=True)
    cuts = [float(x) for x in re.findall(r"pts_time:([\d.]+)", r.stderr)]
    offs = [(round(c * FPS), (np.min(np.abs(bt - c)) * FPS)) for c in cuts]
    planned = sorted({e["frame"] for e in ev["events"] if e["kind"] in ("cut", "hit")})
    print(f"[mp4 picture] {len(cuts)} scene changes detected; offset to nearest beat (frames): " + ", ".join(f"{f}:{o:.1f}" for f, o in offs))
    on = [o for f, o in offs]
    print(f"[mp4 picture] max offset of detected cuts {max(on):.2f} frames; planned cuts not detected (soft changes): {[p for p in planned if all(abs(p - f) > 1 for f, _ in offs)]}")
    import librosa
    wav = os.path.join(ROOT, "out/heist/check.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-vn", "-ac", "1", "-ar", "44100", wav], check=True)
    y, sr = librosa.load(wav, sr=44100, mono=True)
    o = librosa.onset.onset_strength(y=y, sr=sr, hop_length=441)
    t = librosa.times_like(o, sr=sr, hop_length=441)
    res = []
    for a in beats["phraseAccents"]:
        m = (t > a["t"] - 0.06) & (t < a["t"] + 0.06)
        if m.any():
            res.append((a["t"], (t[m][np.argmax(o[m])] - a["t"]) * FPS))
    print("[mp4 audio] phrase accents re-detected in the mp4's music, offset from the analysis (frames): " + ", ".join(f"{a:.2f}s:{d:+.1f}" for a, d in res))
    print(f"[mp4 audio] max |offset| {max(abs(d) for _, d in res):.2f} frames")

    # 3. Per-event check on the decoded picture.
    w, h = (96, 170) if "portrait" in os.path.basename(mp4) else (170, 96)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", mp4, "-vf", f"scale={w}:{h}:flags=area,format=gray", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
    diff = np.zeros(len(fr))
    diff[1:] = np.abs(fr[1:] - fr[:-1]).mean(axis=(1, 2))
    rows, worst_ev, soft = [], 0.0, []
    seen = set()
    for e in ev["events"]:
        F = e["frame"]
        if F == 0 or F >= len(fr) or F in seen:
            continue
        seen.add(F)
        lo, hi = max(1, F - 3), min(len(fr) - 1, F + 3)
        # Onset of the change: the frame where the frame-to-frame change rises the most, so continuous motion in
        # the footage (whose change is large but steady) does not mask a caption or cut that starts on its frame.
        rise = diff[lo:hi + 1] - diff[lo - 1:hi]
        k = lo + int(np.argmax(rise))
        exact = beat_time(e["beat"]) * FPS
        off = k - exact
        base = np.median(diff[max(1, F - 8):F - 3]) if F > 12 else 0
        if diff[k] < 2 * base + 0.5:
            soft.append(F)
        rows.append((F, e["what"], k, off))
        worst_ev = max(worst_ev, abs(off))
    print(f"[mp4 events] {len(rows)} event frames checked; picture change found at offset from exact beat time (frames): "
          + ", ".join(f"{F}:{off:+.1f}" for F, _, k, off in rows))
    bad = [(F, w_, k) for F, w_, k, off in rows if abs(off) > 1.0]
    print(f"[mp4 events] max |offset| {worst_ev:.2f} frames; outside +-1: {bad}; weak changes (motion around them): {soft}")
    cd = [e for e in ev["events"] if e["what"].startswith("countdown digit")]
    print("[mp4 countdown] " + ", ".join(f"{e['what'].split()[-1]} at frame {e['frame']} ({e['frame']/FPS:.3f} s, beat {e['beat']}): change {diff[e['frame']]:.1f} vs prev {diff[e['frame']-1]:.1f}" for e in cd))
