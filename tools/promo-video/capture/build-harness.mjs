// Builds the intro's crowded-tab-strip variant of the character page (harness/crowded.ts) into .harness/.
// It reuses the repository's harness/character.html markup and the extension's real stage modules; the only
// differences are the tab strip (dozens of favicon-only tabs) and the plan's tabIndex/tabCount to match it.
// Run from tools/promo-video:  node capture/build-harness.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.resolve(here, '../.harness');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

const spriteDir = path.join(root, 'assets/sprites');
const sprites = {
  meta: JSON.parse(await readFile(path.join(spriteDir, 'sprites.json'), 'utf8')),
  sheets: await Promise.all([0, 1, 2].map(async (i) => 'data:image/png;base64,' + (await readFile(path.join(spriteDir, `sheet-${i}.png`))).toString('base64'))),
};
await mkdir(out, { recursive: true });
await build({
  entryPoints: [path.join(here, '../harness/crowded.ts')],
  outfile: path.join(out, 'crowded.js'),
  bundle: true, format: 'iife', target: 'chrome120', logLevel: 'info',
  define: { __POCKETS_SPRITES__: JSON.stringify(sprites), __POCKETS_ASSETS__: JSON.stringify(pathToFileURL(path.join(root, 'assets')).href + '/') },
});

// Crowded strip: tabs too narrow for titles show only their favicon, centred, as Chrome does.
const crowdedCss = `
.tab{padding:0;justify-content:center;gap:0;border-right:1px solid var(--strip);border-radius:5px 5px 0 0}
.tab span{display:none}
.tab i,.tab img{width:9px;height:9px;border-radius:2px}
.tab.active{box-shadow:0 0 0 1px var(--line) inset}
.tab.hot img{width:11px;height:11px}
`;
let html = await readFile(path.join(root, 'harness/character.html'), 'utf8');
html = html.replace('</style>', crowdedCss + '</style>').replace('<script src="character.js"></script>', '<script src="crowded.js"></script>');
html = html.replaceAll('../assets/', pathToFileURL(path.join(root, 'assets')).href + '/');
await writeFile(path.join(out, 'crowded.html'), html);
console.log('built', path.join(out, 'crowded.html'));
