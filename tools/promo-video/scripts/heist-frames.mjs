// Renders single frames of the heist compositions as PNGs, bundling the project once.
//   node scripts/heist-frames.mjs <Heist-Portrait|Heist-Square> <outDir> name:frame[,name:frame...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.resolve(here, '..');
const [id, outDir, list] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browserExecutable = process.env.REMOTION_BROWSER || null;
const serveUrl = await bundle({ entryPoint: path.join(proj, 'src/index.ts'), publicDir: path.join(proj, 'public') });
const composition = await selectComposition({ serveUrl, id, inputProps: {}, browserExecutable });
for (const j of list.split(',')) {
  const [name, frame] = j.split(':');
  await renderStill({ composition, serveUrl, frame: Number(frame), output: path.join(outDir, `${name}.png`), imageFormat: 'png', browserExecutable });
  console.log(name, frame);
}
