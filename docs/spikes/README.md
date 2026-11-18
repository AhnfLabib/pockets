# Spikes (throwaway reference material)

Nothing here ships. These are the mocks and scripts the design was agreed on,
kept so the builder can see exactly what was approved.

- `mock-hand-drawn.html` — the approved look and movement. Open in a browser and press "Play it".
  It is an Artifact page fragment (no `<html>` wrapper), which browsers still render.
- `mock-shapes.html` — the same movement with plain shapes, before the hand-drawn pieces.
- `art/parts.py` — paints the hand-drawn body parts and writes the sprite sheets.
- `art/pockets_draw.py`, `art/pockets-front.png` — front-facing illustration of Pockets.
- `art/icons2.py`, `icons/` — icon concepts. **B (mask)** was chosen.

The art scripts need the `lib/` folder of https://github.com/cloveric/claude-drawing-skill
(MIT, commit 6af36dc) and are run as `python3 -I parts.py <path-to-lib>`.
