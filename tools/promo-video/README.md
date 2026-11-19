# Promo video

The 30-second promo for the Chrome Web Store listing ("Global promo video", landscape 1920×1080) and a portrait
1080×1920 cut for social. Built with [Remotion](https://www.remotion.dev); music and on-screen text only, no voiceover.
One set of scenes renders both compositions, `Promo-Landscape` and `Promo-Portrait` (30 fps, 900 frames), through
`LayoutContext`.

| Time | Scene | On screen |
|---|---|---|
| 0–3 s | Hook | A tab strip filling to forty tabs. "Forty tabs open?" |
| 3–6 s | Meet | The icon pops in. "Meet Pockets." / "the tab-stealing raccoon" |
| 6–12 s | Climb | Real footage: Pockets pokes in ("One does not simply keep forty tabs open.") and climbs. "Leave a tab alone for a day…" |
| 12–17 s | Warning | The real card counting down from 5, at real speed. "…and he gives you five seconds' warning." |
| 17–21 s | Steal | He takes YouTube and bolts; a pointer presses Undo on the notice. "He takes it. Undo brings it back." |
| 21–24 s | Working | The real popup; the pointer flips the Working switch. "Working?" / "Distracting sites get taken too." |
| 24–27 s | Trust | "Never takes tabs you've typed in." / "Nothing leaves your browser." |
| 27–30 s | End card | Icon, "Pockets: the tab-stealing raccoon", "Free on the Chrome Web Store" |

The demo cuts (climb, warning, steal) are placed from the footage's own event marks in its `manifest.json`.

## Footage of the real character

Nothing in the demo or the popup scene is redrawn. `capture/capture.mjs` drives `dist-harness/character.html` (the
extension's own stage, rig and card modules) with Playwright on its fake clock, stepping one video frame (1/30 s) at a
time and pausing and stepping every CSS animation by hand, then screenshots the mock browser as a PNG per frame. A
fixed seed (6) and a fixed clock start make the visit identical on every run. `capture/popup.mjs` does the same for
`dist/popup.html` with `chrome.*` stubbed. `capture/icon512.py` paints the toolbar icon at 512 px with the same code
and seed as `assets/icons/icon-128.png`; its output `public/icon-512.png` is committed.

The captured frames (`public/footage/`, `public/popup/`, about 100 MB) and `out/` are not committed.

## Re-render

Needs Node.js, Python 3 with numpy and Pillow (only to repaint the icon), ffmpeg, and Playwright's Chromium (the
repository's own dev dependency).

```
# 1. From the repository root: build the extension and the character page.
npm install && npm run build

# 2. Capture the footage (about 3 minutes).
cd tools/promo-video
npm install
node capture/capture.mjs --seed 6 --variant landscape
node capture/capture.mjs --seed 6 --variant portrait
node capture/popup.mjs

# 3. Render both cuts, mix the music and mux (about 2 minutes).
#    If Remotion cannot download its headless Chrome, point it at a local one, e.g. Playwright's:
#    export REMOTION_BROWSER=/path/to/chrome-headless-shell
./render.sh
```

Outputs: `out/pockets-promo-landscape.mp4` and `out/pockets-promo-portrait.mp4`, H.264 (CRF 18, yuv420p) and AAC,
exactly 30 s. The music is the promo-video skill's "Motivational Day" (Pixabay), at volume 0.10 with a 2 s fade-in
and a 3 s fade-out; `MUSIC=/path/to/track.mp3 ./render.sh` uses another file.

Other tools: `npx remotion studio` previews the compositions; `node capture/capture.mjs --scan 1-20` plays seeds
quickly and writes thumbnails to `out/scan/` to choose another visit (seeds with a quote bubble are listed with
`bubbleFrames=60`).
