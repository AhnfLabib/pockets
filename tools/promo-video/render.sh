#!/usr/bin/env bash
# Renders both promo cuts, mixes the music under them and muxes the final MP4s into out/.
# Needs the captured footage first (see README). Set REMOTION_BROWSER to a local Chromium headless shell when
# Remotion cannot download its own; MUSIC to the track (default: the promo-video skill's Motivational Day).
set -euo pipefail
cd "$(dirname "$0")"
MUSIC="${MUSIC:-$HOME/.claude/skills/promo-video/music/motivational-day-112790.mp3}"
FFMPEG="${FFMPEG:-ffmpeg}"
mkdir -p out
for v in landscape portrait; do
  id="Promo-$(tr '[:lower:]' '[:upper:]' <<< "${v:0:1}")${v:1}"
  npx remotion render src/index.ts "$id" "out/video-$v.mp4" --codec=h264 --crf=18 --pixel-format=yuv420p --muted
done
# Music only (no voiceover): volume 0.30, 2 s fade in, 3 s fade out, exactly 30 s.
"$FFMPEG" -y -loglevel error -i "$MUSIC" -t 30 \
  -af "volume=0.30,afade=t=in:st=0:d=2,afade=t=out:st=27:d=3,apad=whole_dur=30" -ar 48000 -ac 2 -c:a aac -b:a 192k out/music.m4a
for v in landscape portrait; do
  "$FFMPEG" -y -loglevel error -i "out/video-$v.mp4" -i out/music.m4a -map 0:v:0 -map 1:a:0 \
    -c:v copy -c:a copy -t 30 -movflags +faststart "out/pockets-promo-$v.mp4"
done
ls -la out/pockets-promo-*.mp4
