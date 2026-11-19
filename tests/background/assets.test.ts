import { describe, it, expect, vi } from 'vitest';
import { AssetCache, MARK_ICON, SPRITE_DIR, toBase64, type AssetFiles } from '../../src/background/assets';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const META = { scale: 2, parts: { head: { x: 0, y: 0, w: 1, h: 1, ox: 0, oy: 0 } } };

function files(over: Record<string, () => Promise<ArrayBuffer>> = {}) {
  const content: Record<string, string> = {
    [SPRITE_DIR + 'sprites.json']: JSON.stringify(META),
    [SPRITE_DIR + 'sheet-0.png']: 'zero',
    [SPRITE_DIR + 'sheet-1.png']: 'one',
    [SPRITE_DIR + 'sheet-2.png']: 'two',
    [MARK_ICON]: 'icon',
  };
  const read = vi.fn(async (path: string) => {
    if (over[path]) return over[path]();
    if (!(path in content)) throw new Error('missing ' + path);
    return bytes(content[path]);
  });
  return { read } satisfies AssetFiles;
}

const png = (s: string) => 'data:image/png;base64,' + btoa(s);

describe('background asset cache (pockets/sprites)', () => {
  it('serves the metadata, the three sheets and the icon as data URLs', async () => {
    const cache = new AssetCache(files());
    expect(await cache.spritesReply()).toEqual({ ok: true, meta: META, sheets: [png('zero'), png('one'), png('two')], icon: png('icon') });
    expect(await cache.icon()).toBe(png('icon'));
  });

  it('reads the package once and answers later requests from the cache', async () => {
    const f = files();
    const cache = new AssetCache(f);
    const [a, b] = await Promise.all([cache.spritesReply(), cache.spritesReply()]);
    const c = await cache.spritesReply();
    await cache.icon();
    expect(a).toEqual(b);
    expect(c).toEqual(a);
    expect(f.read).toHaveBeenCalledTimes(5); // sprites.json, three sheets, the icon: each once
  });

  it('a failed read replies ok:false and is not cached: the next request reads again', async () => {
    let fail = true;
    const f = files({ [SPRITE_DIR + 'sheet-1.png']: async () => { if (fail) throw new Error('io'); return bytes('one'); } });
    const cache = new AssetCache(f);
    expect(await cache.spritesReply()).toEqual({ ok: false });
    fail = false;
    const r = await cache.spritesReply();
    expect(r.ok).toBe(true);
  });

  it('a malformed sprites.json replies ok:false', async () => {
    const cache = new AssetCache(files({ [SPRITE_DIR + 'sprites.json']: async () => bytes('{"nope":1}') }));
    expect(await cache.spritesReply()).toEqual({ ok: false });
  });

  it('an unreadable icon rejects without being cached', async () => {
    let fail = true;
    const cache = new AssetCache(files({ [MARK_ICON]: async () => { if (fail) throw new Error('io'); return bytes('icon'); } }));
    await expect(cache.icon()).rejects.toThrow();
    fail = false;
    expect(await cache.icon()).toBe(png('icon'));
  });

  it('toBase64 handles buffers larger than one chunk', () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(toBase64(big.buffer)).toBe(Buffer.from(big).toString('base64'));
  });
});
