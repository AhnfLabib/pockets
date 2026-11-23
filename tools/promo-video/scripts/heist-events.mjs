// Bundles src/heist/timeline.ts (with its beats.json) and writes out/heist/events.json: every beat-synced event
// (cuts, caption changes, action hits) with its beat and frame, plus the scene table and the duration.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.resolve(here, '..');
const root = path.resolve(proj, '../..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
const out = path.join(proj, 'out/heist');
mkdirSync(out, { recursive: true });
const file = path.join(out, 'timeline.mjs');
await build({ entryPoints: [path.join(proj, 'src/heist/timeline.ts')], outfile: file, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const tl = await import(pathToFileURL(file).href);
const scenes = Object.fromEntries(Object.entries(tl.SCENES).map(([k, [a, b]]) => [k, { fromBeat: a, toBeat: b, from: tl.B(a), to: tl.B(b) }]));
const data = { fps: tl.FPS, bpm: tl.BPM, offset: tl.OFFSET, duration: tl.DURATION, tail: tl.TAIL, steal: tl.STEAL, undo: tl.UNDO, endcard: tl.ENDCARD, final: tl.FINAL, scenes, events: tl.events() };
writeFileSync(path.join(out, 'events.json'), JSON.stringify(data, null, 1));
console.log(`duration ${data.duration} frames (${(data.duration / 30).toFixed(2)} s), ${data.events.length} events`);
