#!/usr/bin/env python3
"""Beat analysis for the heist video's music (public/heist/fast-percussion.mp3).

Writes src/heist/beats.json, which src/heist/timeline.ts reads to time every cut, caption and action hit. Re-run this
after changing the track and the edit re-times itself.

  python3 scripts/heist-beats.py            (needs ffmpeg, numpy, librosa)

Method. The mp3 is decoded once with ffmpeg to out/heist/track.wav, and the same decode is what the render mixes in,
so there is no decoder-delay drift between analysis and audio. Onset strength comes from librosa (10 ms hop). The beat
period is the autocorrelation peak of the onset envelope in the 90-180 BPM range, refined to sub-hop precision; the
phase is the grid offset that maximises onset strength at the grid points. Phrase accents (the big hits after a short
drop-out) are the strongest jumps in loudness, and the phrase length in beats is the grid spacing they agree on.
Note: librosa's own beat_track locks on to 105 BPM (3/4 of the true pulse) on this track; the grid fit does not.

Video time. The track is near silent for its first second and a half, so the video starts inside the track, on the
first grid beat where the music is properly audible. `offset` is that start in track seconds; every time in the
file is in video seconds (track time minus offset), with frames at 30 fps (round(t * 30), never cumulative).
"""
import json
import os
import subprocess
import sys

import librosa
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "public/heist/fast-percussion.mp3")
WAV = os.path.join(ROOT, "out/heist/track.wav")
OUT = os.path.join(ROOT, "src/heist/beats.json")
FPS = 30
SR = 44100
HOP = 441  # 10 ms


def decode():
    os.makedirs(os.path.dirname(WAV), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", SRC, "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", WAV], check=True)


def main():
    decode()
    y, sr = librosa.load(WAV, sr=SR, mono=True)
    duration = len(y) / sr
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    onset = onset / onset.max()
    dt = HOP / sr
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0]
    rms = rms / rms.max()
    n = min(len(onset), len(rms))
    onset, rms = onset[:n], rms[:n]

    def at(sig, t, w=2):
        i = int(round(t / dt))
        return float(sig[max(0, i - w): i + w + 1].max()) if 0 <= i < len(sig) else 0.0

    # Tempo: autocorrelation peak between 90 and 180 BPM, refined by a parabola through the peak.
    ac = librosa.autocorrelate(onset - onset.mean(), max_size=int(2.0 / dt))
    lo, hi = int(60 / 180 / dt), int(60 / 90 / dt)
    k = lo + int(np.argmax(ac[lo:hi + 1]))
    a, b, c = ac[k - 1], ac[k], ac[k + 1]
    lag = k + 0.5 * (a - c) / (a - 2 * b + c)
    period = lag * dt

    # Fine-tune the period and phase together: maximise mean onset strength on the grid.
    best = None
    for p in np.linspace(period * 0.995, period * 1.005, 41):
        for ph in np.arange(0, p, 0.005):
            grid = np.arange(ph, duration, p)
            s = np.mean([at(onset, t) for t in grid])
            if best is None or s > best[0]:
                best = (s, p, ph)
    _, period, phase = best
    bpm = 60 / period

    grid = np.arange(phase, duration, period)
    # Accent strength per beat: onset peak times the loudness jump into the beat (drop-out, then a big hit).
    def jump(t):
        before = float(np.mean(rms[max(0, int((t - 0.12) / dt)): max(1, int((t - 0.03) / dt))]))
        return max(0.0, at(rms, t, 4) - before)
    acc = np.array([at(onset, t) * (0.3 + jump(t)) for t in grid])

    # Phrase length: of 4, 8 or 16 beats, the spacing whose grid phase collects the most accent strength.
    scores = {}
    for L in (4, 8, 16):
        scores[L] = max((acc[off::L].mean() - acc.mean(), off) for off in range(L))
    # Longer phrases always score a little higher on fewer samples; take the shortest that is nearly as good.
    top = max(v[0] for v in scores.values())
    phrase = next(L for L in (4, 8, 16) if scores[L][0] >= 0.8 * top)
    phrase_phase = scores[phrase][1]
    print("phrase scores", {L: round(float(v[0]), 3) for L, v in scores.items()})

    # Video start: the first grid beat where the music is properly audible (RMS over 25% of the peak nearby).
    start_beat = next(i for i, t in enumerate(grid) if at(rms, t, 5) > 0.25)
    offset = float(grid[start_beat])
    # Music end: the last grid beat with real loudness after it (the track rings out after its final fill).
    audible = [i for i, t in enumerate(grid) if at(rms, t, 8) > 0.25]
    last_audible = audible[-1]

    beats = []
    for i in range(start_beat, len(grid)):
        t = float(grid[i]) - offset
        beats.append({
            "i": i - start_beat,
            "t": round(t, 4),
            "frame": int(round(t * FPS)),
            "bar": int((i - phrase_phase) // 4),
            "beatInBar": int((i - phrase_phase) % 4),
            "phraseStart": bool((i - phrase_phase) % phrase == 0),
            "accent": round(float(acc[i]), 4),
            "onset": round(at(onset, grid[i]), 4),
            "audible": bool(i <= last_audible),
        })
    phrase_starts = [b for b in beats if b["phraseStart"] and b["audible"] and b["t"] > 0]
    # Normalised accent rank of the phrase starts, strongest first.
    ranked = sorted(phrase_starts, key=lambda b: -b["accent"])

    # Onset curve for the beat map, in video time (10 ms steps).
    i0 = int(round(offset / dt))
    curve = {"dt": float(dt), "onset": [round(float(v), 3) for v in onset[i0:]], "rms": [round(float(v), 3) for v in rms[i0:]]}

    data = {
        "source": "public/heist/fast-percussion.mp3",
        "decoded": "out/heist/track.wav (ffmpeg, 44.1 kHz)",
        "fps": FPS,
        "bpm": round(float(bpm), 3),
        "period": round(float(period), 5),
        "phraseBeats": phrase,
        "offset": round(offset, 5),
        "trackDuration": round(duration, 4),
        "librosaBeatTrackBpm": round(float(np.atleast_1d(librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=HOP)[0])[0]), 2),
        "beats": beats,
        "phraseAccents": [{"i": b["i"], "t": b["t"], "frame": b["frame"], "accent": b["accent"]} for b in phrase_starts],
        "strongest": [{"i": b["i"], "t": b["t"], "frame": b["frame"], "accent": b["accent"]} for b in ranked],
    }
    with open(OUT, "w") as f:
        json.dump(data, f, indent=1)
    with open(os.path.join(ROOT, "out/heist/curve.json"), "w") as f:
        json.dump(curve, f)
    print(f"bpm {bpm:.2f} period {period:.4f}s phrase {phrase} beats, offset {offset:.3f}s, {len(beats)} beats")
    print("phrase accents (video s):", [(b["i"], b["t"], b["accent"]) for b in phrase_starts])
    print("strongest:", [(b["i"], b["t"]) for b in ranked[:4]])


if __name__ == "__main__":
    sys.exit(main())
