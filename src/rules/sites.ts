// Pure site matching. No chrome.* access.

/** Lower-case host without a leading "www.", or null when the URL is not http(s). */
export function siteOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  return host || null;
}

/** True when the URL's host equals a listed site or is a subdomain of one. */
export function matchesSite(url: string, sites: string[]): boolean {
  const host = siteOf(url);
  if (host === null) return false;
  return sites.some((raw) => {
    const site = raw.trim().toLowerCase().replace(/^www\./, '');
    return site !== '' && (host === site || host.endsWith('.' + site));
  });
}
