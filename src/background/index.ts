// Background service worker stub. Task 1 only answers the ping message.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'pockets/ping') {
    sendResponse({ type: 'pockets/pong', from: 'background' });
  }
  return false;
});
