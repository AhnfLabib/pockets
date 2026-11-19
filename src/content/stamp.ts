// Which build of the extension a content script belongs to: extension id, manifest version and a stamp that
// scripts/build.mjs sets per build (so reloading an unpacked build with an unchanged version still differs).
declare const __POCKETS_BUILD__: string;

export function buildStamp(): string {
  let version = '';
  try {
    version = chrome.runtime.getManifest().version;
  } catch {
    /* dead context: the stamp then matches nothing live */
  }
  return `${chrome.runtime?.id ?? ''}:${version}:${__POCKETS_BUILD__}`;
}
