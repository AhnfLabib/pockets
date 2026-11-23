#!/usr/bin/env bash
# Renders the LinkedIn intro (composition Intro-Portrait), its storyboard and its stills into out/intro/.
# Needs the crowded footage (public/footage/intro) and the popup frames (public/popup); see README, "Intro video".
#   ./render-intro.sh            draft: 540x960 with music -> out/intro/intro-roughcut.mp4, plus storyboard and stills
#   FINAL=1 ./render-intro.sh    full 1080x1920 at CRF 18  -> out/intro/pockets-intro.mp4
# Set REMOTION_BROWSER to a local Chromium headless shell when Remotion cannot download its own; MUSIC to the track.
set -euo pipefail
cd "$(dirname "$0")"
MUSIC="${MUSIC:-$HOME/.claude/skills/promo-video/music/the-upbeat-inspiring-corporate-142313.mp3}"
mkdir -p out/intro public/music
cp "$MUSIC" public/music/intro.mp3
# Volume 0.30 with short fades is applied in the composition (src/intro/Intro.tsx).
PROPS='{"music":"music/intro.mp3"}'
if [[ "${FINAL:-}" == 1 ]]; then
  npx remotion render src/index.ts Intro-Portrait out/intro/pockets-intro.mp4 --props="$PROPS" \
    --codec=h264 --crf=18 --pixel-format=yuv420p --audio-codec=aac --audio-bitrate=192k
else
  npx remotion render src/index.ts Intro-Portrait out/intro/intro-roughcut.mp4 --props="$PROPS" \
    --scale=0.5 --codec=h264 --crf=23 --pixel-format=yuv420p --audio-codec=aac --image-format=jpeg
fi
node scripts/intro-stills.mjs
python3 scripts/intro-sheets.py
ls -la out/intro
