// Wires the settings page to chrome.storage.local and the background.
import { Store } from '../background/store';
import { chromeKV } from '../background/kv';
import { renderOptions } from './options';

const root = document.getElementById('app');
if (root) {
  void renderOptions(root, {
    store: new Store(chromeKV),
    undo: (takenAt) => { void chrome.runtime.sendMessage({ type: 'pockets/undo', takenAt }); },
  });
}
