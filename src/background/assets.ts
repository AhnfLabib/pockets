// Serves the stage's sprites and the tab mark's icon to content scripts, as data URLs.
//
// Content scripts run on web pages, where loading a chrome-extension:// URL needs `web_accessible_resources` (which
// also lets any page probe for Pockets' files) and fails outright in an orphaned content script whose extension
// context died. The service worker runs on the extension's own origin, so it reads the packaged files itself, once,
// and hands them over by message. A failed read is not cached: the next request tries again.
import type { SpriteMeta } from '../stage/render';

/** The reply to `pockets/sprites`. */
export type SpritesReply = { ok: true; meta: SpriteMeta; sheets: string[]; icon: string } | { ok: false };

export interface AssetFiles {
  /** Reads a packaged file (path relative to the extension root) as bytes. */
  read(path: string): Promise<ArrayBuffer>;
}

export const SPRITE_DIR = 'assets/sprites/';
export const MARK_ICON = 'assets/icons/icon-32.png';

/** Base64 of `bytes`, built in chunks (spreading a whole sheet into String.fromCharCode overflows the stack). */
export function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

const pngUrl = (bytes: ArrayBuffer) => 'data:image/png;base64,' + toBase64(bytes);

function validMeta(m: unknown): m is SpriteMeta {
  return !!m && typeof m === 'object' && typeof (m as SpriteMeta).scale === 'number' && !!(m as SpriteMeta).parts && typeof (m as SpriteMeta).parts === 'object';
}

export class AssetCache {
  private sprites: Promise<Extract<SpritesReply, { ok: true }>> | null = null;
  private iconUrl: Promise<string> | null = null;

  constructor(private files: AssetFiles) {}

  /** The mark and notice icon as a data URL. Rejects (uncached) if it cannot be read. */
  icon(): Promise<string> {
    if (!this.iconUrl) {
      const p = this.files.read(MARK_ICON).then(pngUrl);
      p.catch(() => { if (this.iconUrl === p) this.iconUrl = null; });
      this.iconUrl = p;
    }
    return this.iconUrl;
  }

  /** sprites.json, the three sheets and the icon. Always resolves; `{ ok: false }` when any part cannot be read. */
  async spritesReply(): Promise<SpritesReply> {
    if (!this.sprites) {
      const p = (async () => {
        const json = new TextDecoder().decode(await this.files.read(SPRITE_DIR + 'sprites.json'));
        const meta: unknown = JSON.parse(json);
        if (!validMeta(meta)) throw new Error('Pockets: bad sprites.json');
        const sheets = await Promise.all([0, 1, 2].map(async (i) => pngUrl(await this.files.read(`${SPRITE_DIR}sheet-${i}.png`))));
        return { ok: true as const, meta, sheets, icon: await this.icon() };
      })();
      p.catch(() => { if (this.sprites === p) this.sprites = null; });
      this.sprites = p;
    }
    try {
      return await this.sprites;
    } catch {
      return { ok: false };
    }
  }
}

/** Reads the extension's own packaged files from the service worker (same origin: no web-accessible rules apply). */
export const chromeAssetFiles: AssetFiles = {
  async read(path) {
    const res = await fetch(chrome.runtime.getURL(path));
    if (!res.ok) throw new Error(`Pockets: could not read ${path}`);
    return res.arrayBuffer();
  },
};
