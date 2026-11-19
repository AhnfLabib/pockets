// Content script entry: wires the real chrome APIs into the host logic.
import { mountStage } from '../stage/mount';
import { startContent } from './host';

startContent({
  win: window,
  doc: document,
  assetBase: chrome.runtime.getURL('assets/'),
  iconUrl: chrome.runtime.getURL('assets/icons/icon-32.png'),
  sendMessage: (m) => chrome.runtime.sendMessage(m),
  onMessage: (fn) => chrome.runtime.onMessage.addListener((m, _s, respond) => fn(m, respond) === true),
  mountStage: (d, base) => mountStage(d, base),
});
