// Bundles src/* into dist/ and copies the static extension/ (and assets/, once it exists).
// dist/ is the extension folder and holds only what the manifest needs.
// Also builds the owner-facing character page into dist-harness/, outside the extension (see harness/character.html).
//
// POCKETS_TEST=1 makes a test build: __POCKETS_TEST__ is true and the background compiles in the e2e-only
// `pockets/test-set` hook. In a normal build it is false and esbuild drops that code entirely.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const harnessDist = join(root, 'dist-harness');
const testBuild = process.env.POCKETS_TEST === '1';
// Differs on every build, so the content scripts' run-once guard (src/content/guard.ts) tells a reloaded or updated
// build from the one already running in a page, even when the manifest version is unchanged.
const buildStamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await rm(dist, { recursive: true, force: true });
await rm(harnessDist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    background: join(root, 'src/background/index.ts'),
    content: join(root, 'src/content/index.ts'),
    'content-start': join(root, 'src/content/start.ts'),
    options: join(root, 'src/options/main.ts'),
    popup: join(root, 'src/popup/main.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: false,
  logLevel: 'info',
  // minifySyntax folds `if (false) { ... }` away, so the test-only hook is not shipped. Names and whitespace are kept.
  minifySyntax: true,
  define: { __POCKETS_TEST__: JSON.stringify(testBuild), __POCKETS_BUILD__: JSON.stringify(buildStamp) },
});
if (testBuild) console.log('POCKETS_TEST=1: test build, with the pockets/test-set hook');

await cp(join(root, 'extension'), dist, { recursive: true });
await cp(join(root, 'src/options/options.html'), join(dist, 'options.html'));
await cp(join(root, 'src/options/options.css'), join(dist, 'options.css'));
await cp(join(root, 'src/popup/popup.html'), join(dist, 'popup.html'));
await cp(join(root, 'src/popup/popup.css'), join(dist, 'popup.css'));
if (await exists(join(root, 'assets'))) {
  await cp(join(root, 'assets'), join(dist, 'assets'), { recursive: true });
}

// The character page: opened straight from dist-harness/ as a file, where fetch() cannot read sprites.json,
// so the real sprite sheets and their metadata are embedded in its bundle as data URLs.
const spriteDir = join(root, 'assets/sprites');
const harnessSprites = {
  meta: JSON.parse(await readFile(join(spriteDir, 'sprites.json'), 'utf8')),
  sheets: await Promise.all(
    [0, 1, 2].map(async (i) => 'data:image/png;base64,' + (await readFile(join(spriteDir, `sheet-${i}.png`))).toString('base64')),
  ),
};
await mkdir(harnessDist, { recursive: true });
await build({
  entryPoints: [join(root, 'harness/character.ts')],
  outfile: join(harnessDist, 'character.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: false,
  logLevel: 'info',
  define: { __POCKETS_SPRITES__: JSON.stringify(harnessSprites) },
});
await cp(join(root, 'harness/character.html'), join(harnessDist, 'character.html'));
