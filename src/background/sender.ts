// Which message senders are our own pages (popup, options) rather than content scripts on web pages.
/** True when `url` is a page of this extension, whose root is `extensionRoot` (chrome.runtime.getURL('')). */
export function isExtensionPage(url: string | undefined, extensionRoot: string): boolean {
  return typeof url === 'string' && extensionRoot.length > 0 && url.startsWith(extensionRoot);
}

/**
 * May this sender undo `taken`? Extension pages always; a web page only if it is the top frame of the tab
 * that was shown the in-page notice for this take.
 */
export function canUndo(
  sender: { url?: string; frameId?: number; tab?: { id?: number } },
  taken: { noticeTabId?: number } | undefined,
  extensionBase: string,
): boolean {
  if (!taken) return false;
  if (isExtensionPage(sender.url, extensionBase)) return true;
  return sender.frameId === 0 && sender.tab?.id !== undefined && sender.tab.id === taken.noticeTabId;
}
