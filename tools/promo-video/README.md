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
exactly 30 s. The music is the promo-video skill's "Motivational Day" (Pixabay), at volume 0.30 with a 2 s fade-in
and a 3 s fade-out; `MUSIC=/path/to/track.mp3 ./render.sh` uses another file.

Other tools: `npx remotion studio` previews the compositions; `node capture/capture.mjs --scan 1-20` plays seeds
quickly and writes thumbnails to `out/scan/` to choose another visit (seeds with a quote bubble are listed with
`bubbleFrames=60`).

## Intro video (LinkedIn, portrait)

A separate 21-second portrait cut, `Intro-Portrait` (1080×1920, 30 fps, 638 frames), with its own scenes in
`src/intro/`. The whole timeline (scene lengths, every caption, storyboard key frames, stills) is in
`src/intro/timeline.ts`. The composition reads it, and so do the storyboard and stills scripts.

| Time | On screen |
|---|---|
| 0–2.3 s | Hook: a browser crammed with 32 favicon-only tabs, opening close on the strip. Pockets pokes in with a quote and climbs (1.5×, then about 1.8×). "Too many tabs? / Meet Pockets." |
| 2.3–7.3 s | Push in on the real warning card counting down at real speed. "He gives you five seconds." then "Keep the tab, or it's his." |
| 7.3–10.5 s | He takes YouTube and bolts with it in his mouth; a pointer presses Undo. "He takes it and runs." then "Undo brings it back." |
| 10.5–12.7 s | "Pockets never takes": Pinned tabs, Tabs you've typed in, Your last tab |
| 12.7–15.2 s | The real popup; the Working switch flips on. "Working mode / Distracting sites get taken too." |
| 15.2–17.3 s | "Everything stays in your browser. / No accounts. No servers. No tracking." |
| 17.3–21.3 s | End card: icon, "Pockets: the tab-stealing raccoon", "Available on the Chrome Web Store" |

The hook uses a variant of the character page that the extension's harness does not include:
`harness/crowded.ts`, built by `capture/build-harness.mjs` into `.harness/crowded.html` (gitignored). It runs the
same stage modules with a 32-tab strip and the matching `tabIndex`/`tabCount`. The repository's `harness/` and `src/`
are not changed. Music is the skill's "Upbeat Inspiring Corporate" at 0.30 with a 0.2 s fade-in and a 1.5 s fade-out,
mixed in the composition.

```
# From the repository root: npm install && npm run build. Then, in tools/promo-video:
node capture/build-harness.mjs
node capture/capture.mjs --seed 1 --variant portrait --page crowded --tabs 32 --target 12 --out intro
node capture/popup.mjs                 # if public/popup/ is not there yet
export REMOTION_BROWSER=/path/to/chrome-headless-shell   # if Remotion cannot download its own
./render-intro.sh                      # draft: out/intro/intro-roughcut.mp4 (540x960), storyboard, stills
FINAL=1 ./render-intro.sh              # full size: out/intro/pockets-intro.mp4
```

Outputs go to `out/intro/`: `storyboard.png` and `storyboard.md` (from `scripts/intro-stills.mjs` and
`scripts/intro-sheets.py`), and `stills/` (each still as a 1080×1920 portrait and a 1080×1080 square, PNG RGB).
`node capture/capture.mjs --scan 1-20 --variant portrait --page crowded` compares seeds on the crowded page.

## Heist video (LinkedIn, portrait and landscape, cut to the music)

A third cut in two native layouts with the same beat timing: `Heist-Portrait` (1080×1920) and `Heist-Landscape`
(1920×1080), 30 fps, about 26 s, in a "night heist" style: dark charcoal, a spotlight on Pockets, red (#d9483b) as the
only accent, real footage cropped tight in dark mode, huge Anton captions a few words per beat, Space Mono case-file
tags. Its scenes are in `src/heist/`; `HeistLayoutProvider`/`useLayout` (in `kit.tsx`) give each scene its layout, so
one set of scenes lays itself out for portrait, landscape (Pockets and footage large on the left, captions in a column
on the right, the tab bar across the full width, the end card side by side) and square. `Heist-Square` (1080×1080) is
used for stills only.

**Tab bar.** The crammed browser tab bar is drawn as vectors (`src/heist/tabbar.tsx`), not taken from the footage: a
short Chrome-style strip of 47 narrow tabs, each a favicon and a title that fades where it truncates, a proper active
tab joined to the toolbar, muted favicons and YouTube (the target) as the only red one, which glows. Scenes move a
camera over it (crisp at any size). In the opening, Pockets is the alpha cutout of the real visit placed on the bar's
geometry: the captured YouTube tab's centre on the drawn YouTube tab, the captured page top on the bar's bottom edge.
The real-footage scenes hide the captured page's own strip and toolbar (`cropTop`) and, in landscape, fade out before
the page's right edge.

**Cut to the beats.** The music is "Fast Percussion" by lNPLUSMUSIC (Pixabay Content License: free use, no
attribution required), committed at `public/heist/fast-percussion.mp3`. `scripts/heist-beats.py` decodes it once with
ffmpeg, finds the tempo (140 BPM, by onset autocorrelation and a grid fit; librosa's own beat tracker reads 105, three
quarters of the pulse), the beat phase, the 8-beat phrases and their accents, and the start offset inside the track
(it is near silent for its first 1.5 s). It writes `src/heist/beats.json` in video time (seconds and frames).
`src/heist/timeline.ts` places every cut, caption change and action hit on beat indices relative to the phrase accents:
the steal and Undo on the strongest adjacent pair mid-story, the end card on the second-to-last accent, the video ending
0.5 s after the last accent with a fade. Re-run the analysis and the edit re-times itself. The countdown plays 5, 4, 3,
2, 1 on the five consecutive beats before the steal accent; at each digit the footage jumps to the card's own tick, so
its "Mine in N…" matches the big digit. The take lands on the steal beat, the Undo click on the Undo beat.

**Footage.** Three extra captures, all gitignored: the crowded page with 47 tabs in dark mode at 5× (sharp card,
notice and text at the tight crops; Pockets' sprites are 3× bitmaps, so only the page gains), the same visit on a
transparent page at 3× (`--bare`: Pockets alone on alpha, for the graphic scenes and the opening), and the dark popup
at 6×. `scripts/heist-track.py` tracks his head (his eye whites) so the spotlight and the crops follow him. The flags
added for this (`--dsf`, `--scheme dark`, `--bare`; `popup.mjs --scheme --out --dsf`) leave the other captures exactly
as before; `harness/crowded.ts` gained a dark page style and the `bare` query.

```
# From the repository root: npm install && npm run build. Then, in tools/promo-video (Python: librosa, scipy, matplotlib):
node capture/build-harness.mjs
node capture/capture.mjs --seed 1 --variant portrait --page crowded --tabs 47 --target 19 --dsf 5 --scheme dark --out heist
node capture/capture.mjs --seed 1 --variant portrait --page crowded --tabs 47 --target 19 --dsf 3 --bare --out heist-bare
node capture/popup.mjs --scheme dark --dsf 6 --out heist-popup
export REMOTION_BROWSER=/path/to/chrome-headless-shell   # if Remotion cannot download its own
./render-heist.sh            # out/heist/pockets-heist-portrait.mp4 and pockets-heist-landscape.mp4 (final quality)
DRAFT=1 ./render-heist.sh    # quick check: out/heist/*-draft.mp4 (ONLY=portrait or ONLY=landscape renders one)
```

The script renders each composition's picture muted to a near-lossless intermediate, trims the decoded track
sample-accurately at the analysis offset, fades the tail, normalises to −14 LUFS integrated with true peak at most
−1 dBTP (`scripts/heist-audio.py`: linear gain and a peak limiter) and encodes once: H.264 High profile, yuv420p
BT.709, CRF 17, AAC 192 kb/s, faststart. It also writes `out/heist/beat-map.png` and `heist.md` (every beat-synced
event and its time, `scripts/heist-map.py`), runs `scripts/heist-sync.py` on both files (every event on a beat in the
timeline; on each mp4, the detected cuts, the music's accents, and the frame where the picture actually changes around
every event, against the beat grid) and renders the five stills as portrait, square and landscape PNGs into
`out/heist/stills/` (`scripts/heist-stills.py`).
