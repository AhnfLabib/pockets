// Renders the intro's storyboard key frames and LinkedIn stills as PNGs, bundling the project once.
// Frames and labels come from src/intro/timeline.ts (imported with Node's type stripping), so they match the video.
//   node scripts/intro-stills.mjs            -> out/intro/frames/*.png + out/intro/frames/index.json
// Then scripts/intro-sheets.py builds storyboard.png, storyboard.md and the stills (portrait + square).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import * as tl from '../src/intro/timeline.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.resolve(here, '..');
const out = path.join(proj, 'out/intro/frames');
mkdirSync(out, { recursive: true });
const browserExecutable = process.env.REMOTION_BROWSER || null;
const serveUrl = await bundle({ entryPoint: path.join(proj, 'src/index.ts'), publicDir: path.join(proj, 'public') });
const composition = await selectComposition({ serveUrl, id: 'Intro-Portrait', inputProps: {}, browserExecutable });
const only = process.argv[2] ? process.argv[2].split(',') : null;
const jobs = [
  ...tl.STORYBOARD.map((s, i) => ({ name: `sb-${String(i).padStart(2, '0')}`, frame: s.frame })),
  ...tl.STILLS.map((s) => ({ name: `still-${s.name}`, frame: s.frame })),
  ...(process.env.EXTRA ? process.env.EXTRA.split(',').map((f) => ({ name: `x-${f}`, frame: Number(f) })) : []),
].filter((j) => !only || only.some((o) => j.name.startsWith(o)));
for (const j of jobs) {
  await renderStill({ composition, serveUrl, frame: j.frame, output: path.join(out, `${j.name}.png`), imageFormat: 'png', browserExecutable });
  console.log(j.name, j.frame);
}
const lineAt = (abs) => {
  const scene = [...tl.SCENES].reverse().find((s) => tl.sceneStart(s.id) <= abs);
  const rel = abs - tl.sceneStart(scene.id);
  const l = tl.LINES.find((x) => x.scene === scene.id && x.from <= rel && (x.to === undefined || rel < x.to));
  return l ? (l.sub ? `${l.text} / ${l.sub}` : l.text) : '';
};
writeFileSync(path.join(out, 'index.json'), JSON.stringify({
  fps: tl.FPS, duration: tl.DURATION, fade: tl.FADE,
  scenes: tl.SCENES.map((s) => ({ ...s, start: tl.sceneStart(s.id) })),
  lines: tl.LINES.map((l) => ({ ...l, absFrom: tl.sceneStart(l.scene) + l.from, absTo: l.to === undefined ? null : tl.sceneStart(l.scene) + l.to })),
  storyboard: tl.STORYBOARD.map((s, i) => ({ ...s, file: `sb-${String(i).padStart(2, '0')}.png`, caption: lineAt(s.frame) })),
  stills: tl.STILLS,
  demo: { ...tl.DEMO, take: tl.TAKE, undo: tl.UNDO },
}, null, 2));
