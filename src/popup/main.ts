// Wires the popup to chrome.storage.local and the background.
import { Store } from '../background/store';
import { chromeKV } from '../background/kv';
import { renderPopup } from './popup';

const root = document.getElementById('app');
// Held while the popup is open, so the background re-checks the visit's stage when it closes.
try { chrome.runtime.connect({ name: 'pockets-popup' }); } catch { /* the background reconnects on its own events */ }
if (root) {
  void (async () => {
    let currentUrl: string | null = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentUrl = tab?.url ?? null;
    } catch {
      currentUrl = null;
    }
    await renderPopup(root, {
      store: new Store(chromeKV),
      currentUrl,
      now: () => Date.now(),
      setWorking: async (on) => {
        const reply = (await chrome.runtime.sendMessage({ type: 'pockets/set-working', on })) as { ok?: boolean } | undefined;
        if (!reply || reply.ok !== true) throw new Error('working mode was not changed');
      },
      undo: (takenAt) => { void chrome.runtime.sendMessage({ type: 'pockets/undo', takenAt }); },
      openOptions: () => { void chrome.runtime.openOptionsPage(); },
    });
  })();
}
