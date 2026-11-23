#!/usr/bin/env bash
# Renders the "night heist" LinkedIn intro (composition Heist-Portrait) cut to the beats of public/heist/fast-percussion.mp3,
# plus its beat map, event list, sync check and stills, into out/heist/. Needs the heist captures (see README, "Heist video").
#   ./render-heist.sh            rough cut: 1080x1920, JPEG frames, CRF 21  -> out/heist/heist-roughcut.mp4
#   FINAL=1 ./render-heist.sh    CRF 18, PNG frames                     -> out/heist/pockets-heist.mp4
# Set REMOTION_BROWSER to a local Chromium headless shell when Remotion cannot download its own.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out/heist
python3 scripts/heist-beats.py          # beats.json (re-times the edit) + out/heist/track.wav
python3 scripts/heist-track.py >/dev/null
node scripts/heist-events.mjs           # out/heist/events.json
read -r FRAMES TAIL < <(python3 -c "import json;d=json.load(open('out/heist/events.json'));print(d['duration'],d['tail'])")
DUR=$(python3 -c "print($FRAMES/30)"); TAILS=$(python3 -c "print($TAIL/30)")
if [[ "${FINAL:-}" == 1 ]]; then OUT=out/heist/pockets-heist.mp4; Q=(--crf=16); CRF=18; else OUT=out/heist/heist-roughcut.mp4; Q=(--crf=18 --image-format=jpeg --jpeg-quality=90); CRF=21; fi
npx remotion render src/index.ts Heist-Portrait out/heist/video.mp4 --codec=h264 --pixel-format=yuv420p --muted "${Q[@]}"
# Music: trimmed at the analysis offset (sample-accurate), 0.5 s tail fade after the final hit, -14 LUFS, TP <= -1 dBTP.
python3 scripts/heist-audio.py "$DUR" "$TAILS"
# Re-encoded here so the picture is limited-range yuv420p whatever Remotion's frame format.
ffmpeg -y -loglevel error -i out/heist/video.mp4 -i out/heist/music.wav -map 0:v:0 -map 1:a:0 \
  -vf scale=out_range=tv -c:v libx264 -preset medium -crf "${CRF:-20}" -pix_fmt yuv420p -color_range tv \
  -c:a aac -b:a 192k -t "$DUR" -movflags +faststart "$OUT"
python3 scripts/heist-audio.py --measure "$OUT"
python3 scripts/heist-map.py
python3 scripts/heist-sync.py "$OUT"
python3 scripts/heist-stills.py
ls -la out/heist out/heist/stills
