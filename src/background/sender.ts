// Which message senders are our own pages (popup, options) rather than content scripts on web pages.
/** True when `url` is a page of this extension, whose root is `extensionRoot` (chrome.runtime.getURL('')). */
export function isExtensionPage(url: string | undefined, extensionRoot: string): boolean {
  return typeof url === 'string' && extensionRoot.length > 0 && url.startsWith(extensionRoot);
}
