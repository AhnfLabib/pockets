// Bundles src/* into dist/ and copies the static extension/ (and assets/, once it exists).
// Also builds the character page into dist/harness/ (see harness/character.html).
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    background: join(root, 'src/background/index.ts'),
    content: join(root, 'src/content/index.ts'),
    options: join(root, 'src/options/main.ts'),
    popup: join(root, 'src/popup/main.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: false,
  logLevel: 'info',
});

await cp(join(root, 'extension'), dist, { recursive: true });
await cp(join(root, 'src/options/options.html'), join(dist, 'options.html'));
await cp(join(root, 'src/options/options.css'), join(dist, 'options.css'));
await cp(join(root, 'src/popup/popup.html'), join(dist, 'popup.html'));
await cp(join(root, 'src/popup/popup.css'), join(dist, 'popup.css'));
if (await exists(join(root, 'assets'))) {
  await cp(join(root, 'assets'), join(dist, 'assets'), { recursive: true });
}

// The character page: opened straight from dist/harness/ as a file, where fetch() cannot read sprites.json,
// so the real sprite sheets and their metadata are embedded in its bundle as data URLs.
const spriteDir = join(root, 'assets/sprites');
const harnessSprites = {
  meta: JSON.parse(await readFile(join(spriteDir, 'sprites.json'), 'utf8')),
  sheets: await Promise.all(
    [0, 1, 2].map(async (i) => 'data:image/png;base64,' + (await readFile(join(spriteDir, `sheet-${i}.png`))).toString('base64')),
  ),
};
await mkdir(join(dist, 'harness'), { recursive: true });
await build({
  entryPoints: [join(root, 'harness/character.ts')],
  outfile: join(dist, 'harness/character.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: false,
  logLevel: 'info',
  define: { __POCKETS_SPRITES__: JSON.stringify(harnessSprites) },
});
await cp(join(root, 'harness/character.html'), join(dist, 'harness/character.html'));
