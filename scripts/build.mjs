// Bundles src/* into dist/ and copies the static extension/ (and assets/, once it exists).
import { build } from 'esbuild';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
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
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: false,
  logLevel: 'info',
});

await cp(join(root, 'extension'), dist, { recursive: true });
if (await exists(join(root, 'assets'))) {
  await cp(join(root, 'assets'), join(dist, 'assets'), { recursive: true });
}
