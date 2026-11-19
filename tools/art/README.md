# Artwork pipeline

`paint.py` paints Pockets' body parts and the toolbar icons. Its outputs are committed, so the extension build
never runs Python.

```
python3 -I tools/art/paint.py          # writes assets/sprites/* and assets/icons/*
python3 -m pytest tools/art -q         # checks the committed outputs (run from the repository root)
```

Needs Python 3 with numpy and Pillow. pytest is only for the checks. The tests only read the generated files and
never import the vendored code.

## Vendored library

`vendor/` holds two files from the `lib/` folder of
[cloveric/claude-drawing-skill](https://github.com/cloveric/claude-drawing-skill), commit
`6af36dc717b63d6ddafb54d2eaa120cacd99ab4d` ("Add sunlit greenery style"). It is MIT-licensed, and the licence is
in `vendor/LICENSE`. The files are copied unchanged:

| File | Why it is here |
|---|---|
| `vendor/cartoon.py` | The `Cartoon` painter: brush outlines, slopped flat fills, cel shading, the boil field |
| `vendor/core.py` | Imported by `cartoon.py` for blur, noise, splines, `shift` and `polygon_mask` |

Nothing else in that repository is imported. `cartoon.py` uses `glob` and `os` only to look up system fonts for
lettering, which `paint.py` does not use.

## Sprite sheets

`assets/sprites/sheet-0.png`, `sheet-1.png` and `sheet-2.png` share one layout and are painted with seeds 3, 14
and 27. The renderer cycles them (`Math.floor(t*7) % 3`) so the lines boil. `sprites.json`:

```json
{ "scale": 3, "parts": { "<name>": { "x": 0, "y": 0, "w": 0, "h": 0, "ox": 0, "oy": 0 } } }
```

`x, y, w, h` give the crop in sheet pixels. `ox, oy` give the part's origin in display pixels from the crop's top
left corner. `scale` is sheet pixels per display pixel. To draw a part at its natural size, use
`drawImage(sheet, x, y, w, h, -ox, -oy, w/scale, h/scale)` after translating to the origin and rotating. Every
part faces +x. Each crop has a clear gutter of at least 2 sheet pixels.

| Part | Origin | Notes |
|---|---|---|
| `head` | Centre of the skull ellipse (12.5 x 13 display px) | Ears at (-5, ±11), r 5.5. The snout ellipse is centred at (11.2, 0), 8.4 x 5.6, with the nose at (16.9, 0). |
| `body` | Centre of the capsule | 49 long, 27 wide. Scale x and y to stretch or breathe, as the mock does. |
| `tail` | Centre of the base, which sits under the body | The tail runs straight along **−x** and its painted shape ends 56 display px from the origin. The ink adds about 0.7 px past that. The base is slightly rounded and reaches about +1.2 px. |
| `legUpper` | Hip (or shoulder) joint centre | The next joint centre (the knee or elbow) is 10.5 display px along +x. Half-width tapers from 4.2 to 3.7, with round caps at both joints. |
| `legLower` | Knee (or elbow) joint centre | The foot is 10.5 display px along +x. Half-width tapers from 3.7 to 3.2. The colour is a shade darker than the upper leg. The paw covers the foot end. |
| `paw` | Centre of the palm | The toes point +x. |
| `scarf` | Centre of the band across the neck | The point trails toward −x. This origin already includes the mock's `dx = -5` shift: place it at the neck point with no offset. |

### Tail half-width (for `tailStrip`)

Measured from the base, in display px, and inside the outline:

| u (distance from base) | 0 | 6 | 16 | 30 | 42 | 50 | 56 |
|---|---|---|---|---|---|---|---|
| half-width | 5.6 | 6.7 | 7.0 | 6.2 | 5.2 | 4.3 | 0 (elliptical tip from u = 50) |

The function is `tail_halfwidth` in `paint.py`. When slicing the tail along a spine, map sprite column
`x = ox*scale - u*scale` to arc length `u`.

### Eyes (pupils and blink are drawn in code)

The head sprite carries the eye whites but no pupils. In head-local display px, the whites are circles at
**(1.4, ±7.0) with radius 4.8**. This is larger than in the mock, which had whites at (4.4, ±6.8) r 3.5, pupils
at (5.2, ±6.8) r 2.1, and a blink disc at (4.4, ±6.8) r 4, so the renderer must use the new values. Suggested
values:

- Pupil: r 2.5, centred at (1.4 + 1.0, ±7.0 + gaze offset). Keep it inside the white, which leaves about 2.3 px of
  travel.
- Glint: r 0.8, at +0.9 x and −0.9 y from the pupil centre.
- Blink: a disc in `#2f3340` at (1.4, ±7.0), r 5.4, with a short fur-coloured lid line.

These numbers live in `paint.py` as `EYE_X`, `EYE_Y` and `EYE_R`.

## How the four faults in the mock artwork are fixed

1. **Tail:** one painted piece: a tapering outline with five bowed dark rings and a dark tip, clipped to the fill.
   It is no longer a string of beads. The renderer bends it by slicing.
2. **Legs:** two painted pieces (`legUpper` and `legLower`), each filled, cel-shaded and brush-outlined. They are
   no longer plain strokes.
3. **Paper fringe:** (a) a part's alpha is its shape mask grown by half the ink width (4 paint px) and no further;
   (b) every pixel outside the ungrown mask, transparent pixels included, is recoloured to ink before the
   premultiplied downsample. As a result, the only colour at a part's silhouette is ink. The masks are pushed
   through the same boil displacement as the ink, so the cut follows each sheet's re-traced outline. Under each
   part, the cream paper is also replaced with that part's main colour, so a fill painted slightly off its line
   never uncovers paper inside the outline.
4. **Face:** the eye whites have grown from r 3.5 to r 4.8, as far as the skull outline allows. The mask patches
   are broad ellipses clipped to the skull, reaching its outline. The snout is slightly slimmer and further
   forward than in the spike so that it clears the eyes.

## Icons

`assets/icons/icon-{16,32,48,128}.png`. The design is direction B from `docs/spikes/art/icons2.py` (`mask`): an
extreme close-up with the bandit mask filling a rounded tile. Sizes 48 and 128 are reduced from the full
512 px drawing, using icons2's seed. Sizes 32 and 16 are reduced from simplified drawings with no shading or
forehead stripe, heavier outlines and bigger eyes. The 16 px version has the largest eyes and smallest pupils, so
both eyes stay readable.
