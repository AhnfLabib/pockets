#!/usr/bin/env bash
# Renders the "night heist" LinkedIn intro, cut to the beats of public/heist/fast-percussion.mp3, in two native layouts
# with the same beat timing: Heist-Portrait (1080x1920) and Heist-Landscape (1920x1080). Plus the beat map, the event
# list, the sync check on both files and the stills, into out/heist/. Needs the heist captures (see README, "Heist video").
#   ./render-heist.sh            final quality -> out/heist/pockets-heist-portrait.mp4, out/heist/pockets-heist-landscape.mp4
#   DRAFT=1 ./render-heist.sh    quick check (JPEG frames, CRF 23) -> out/heist/*-draft.mp4, no stills
#   ONLY=portrait|landscape      renders one of the two
# Set REMOTION_BROWSER to a local Chromium headless shell when Remotion cannot download its own.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out/heist
python3 scripts/heist-beats.py          # beats.json (re-times the edit) + out/heist/track.wav
python3 scripts/heist-track.py >/dev/null
node scripts/heist-events.mjs           # out/heist/events.json
read -r FRAMES TAIL < <(python3 -c "import json;d=json.load(open('out/heist/events.json'));print(d['duration'],d['tail'])")
DUR=$(python3 -c "print($FRAMES/30)"); TAILS=$(python3 -c "print($TAIL/30)")
# Music: trimmed at the analysis offset (sample-accurate), 0.5 s tail fade after the final hit, -14 LUFS, TP <= -1 dBTP.
python3 scripts/heist-audio.py "$DUR" "$TAILS"

OUTS=()
for TAG in portrait landscape; do
  [[ -n "${ONLY:-}" && "$ONLY" != "$TAG" ]] && continue
  COMP="Heist-${TAG^}"
  if [[ "${DRAFT:-}" == 1 ]]; then
    OUT="out/heist/pockets-heist-$TAG-draft.mp4"; Q=(--crf=14 --image-format=jpeg --jpeg-quality=92); CRF=23; PRESET=veryfast
  else
    # Near-lossless intermediate from PNG frames, so the one real encode is the final one below.
    OUT="out/heist/pockets-heist-$TAG.mp4"; Q=(--crf=4 --image-format=png); CRF=17; PRESET=slow
  fi
  npx remotion render src/index.ts "$COMP" "out/heist/video-$TAG.mp4" --codec=h264 --pixel-format=yuv420p --muted "${Q[@]}"
  # H.264 High profile, limited-range yuv420p BT.709, AAC 192 kb/s, moov atom first (faststart).
  ffmpeg -y -loglevel error -i "out/heist/video-$TAG.mp4" -i out/heist/music.wav -map 0:v:0 -map 1:a:0 \
    -vf scale=out_range=tv -c:v libx264 -profile:v high -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p -color_range tv \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
    -c:a aac -b:a 192k -t "$DUR" -movflags +faststart "$OUT"
  python3 scripts/heist-audio.py --measure "$OUT"
  ffprobe -v error -show_entries stream=codec_name,profile,pix_fmt,width,height,nb_frames,bit_rate -of compact "$OUT"
  OUTS+=("$OUT")
done

python3 scripts/heist-map.py
for OUT in "${OUTS[@]}"; do python3 scripts/heist-sync.py "$OUT"; done
[[ "${DRAFT:-}" == 1 ]] || python3 scripts/heist-stills.py
ls -la out/heist out/heist/stills
