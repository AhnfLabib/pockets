// chrome.storage.local behind the Store's KV interface.
import type { KV } from './store';

export const chromeKV: KV = {
  async get(key) {
    const r = await chrome.storage.local.get(key);
    return r[key];
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};
