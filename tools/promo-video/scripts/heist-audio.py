#!/usr/bin/env python3
"""Music for the heist cut: trims the decoded track (out/heist/track.wav, from heist-beats.py) sample-accurately at
the analysis offset, fades out over the 0.4 s after the final hit's attack (0.5 s tail), and normalises to -14 LUFS integrated with true peak
at or under -1 dBTP (linear gain plus a gentle peak limiter, no dynamic loudnorm). Writes out/heist/music.wav.
  python3 scripts/heist-audio.py <duration_seconds> <tail_seconds>
  python3 scripts/heist-audio.py --measure file.mp4      (prints integrated loudness and true peak)
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WAV = os.path.join(ROOT, "out/heist/track.wav")
OUT = os.path.join(ROOT, "out/heist/music.wav")
TARGET = -14.0


def measure(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    tail = r.stderr[r.stderr.rfind("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail).group(1))
    return i, tp


def render(dur, tail, gain_db):
    offset = json.load(open(os.path.join(ROOT, "src/heist/beats.json")))["offset"]
    af = f"atrim=start={offset:.5f}:duration={dur:.5f},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st={dur - tail + 0.1:.4f}:d={tail - 0.1:.4f},volume={gain_db:.2f}dB,alimiter=limit=0.8:level=false:attack=2:release=60,aresample=48000"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", WAV, "-af", af, "-c:a", "pcm_s16le", OUT], check=True)
    return measure(OUT)


if __name__ == "__main__":
    if sys.argv[1] == "--measure":
        i, tp = measure(sys.argv[2])
        print(json.dumps({"file": sys.argv[2], "integratedLUFS": i, "truePeakDBTP": tp}))
        sys.exit(0)
    dur, tail = float(sys.argv[1]), float(sys.argv[2])
    gain = 0.0
    for _ in range(4):
        i, tp = render(dur, tail, gain)
        print(f"gain {gain:+.2f} dB -> {i:.2f} LUFS, true peak {tp:.2f} dBTP")
        if abs(i - TARGET) < 0.3:
            break
        gain += TARGET - i
