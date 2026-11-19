# Verification of browser assumptions (Task 1)

Run on 2026-11-18 by `npm run build && npm run e2e -- --trace off`, using `e2e/verify.spec.ts`.
Browser: Playwright 1.63.0's Chromium build (`chromium-1243`, pre-installed at
`/opt/pw-browsers`), Linux container, no display. Each test writes what it saw as `finding` and
`detail` annotations. They are printed to the console and saved in `test-results/results.json`.

## Results

| # | Assumption (design, "To verify first") | Result | What was observed |
|---|---|---|---|
| 1 | A tab's `lastAccessed` survives a browser restart and session restore | **pass** | Three tabs were opened and activated in turn, with tab c last. The browser was closed and relaunched on the same profile with "Continue where you left off" on (`session.restore_on_startup: 1`). All three tabs came back. Tabs a and b, which were not active at shutdown, kept `lastAccessed` within 1 to 2 ms (precision loss only). Tab c was active at shutdown and is reactivated by restore, so it legitimately got a fresh time after the relaunch. `--restore-last-session` behaved the same way (observed in an exploratory run, not reproduced by a committed test). |
| 2 | Undo reopens a closed tab in its old position with its history | **pass** | The target tab sat at index 2, between two other tabs, and had navigated `undo-first` then `undo-second`. After `tabs.remove`, `sessions.getRecentlyClosed` and `sessions.restore`, it came back in the same window at index 2 on `undo-second`. `history.length` was 3, consistent with `about:blank`, first, second. `history.back()` went to `undo-first`. |
| 3 | A background tab that is awake can change its own icon and title | **pass** (verified via `tabs.get`) | In a tab opened with `active: false` and `document.visibilityState === "hidden"`, the swap set `document.title` and replaced the `link[rel=icon]` with a data: URL PNG. `tabs.get` then reported the new title and `favIconUrl` equal to that data: URL. |
| 3b | ...and the change shows on the painted tab bar | **could not verify** | Nothing here inspects the painted tab strip: headless has none, and Playwright cannot screenshot browser chrome. Only the `tabs.get` state in row 3 was checked. |
| 4 | The stage can be drawn over pages with a strict content security policy | **pass** (primitives) | The page was served with `Content-Security-Policy: default-src 'none'`. As a control, the page's own inline script was blocked. In the isolated world, the test attached a shadow root with a fixed full-viewport canvas, drew red and read back `[255,0,0,255]`. `tabs.captureVisibleTab` showed the same red pixel on screen. A `<style>` element inside the shadow root applied, and so did a constructed `CSSStyleSheet` via `adoptedStyleSheets`. A data: URL image decoded and drew onto the canvas. **Update (release 1.0):** the stage never loads the extension's files into the page. The background service worker reads the sprites and icon from the package and sends them to the content script as data: URLs (`pockets/sprites`, and the icon on `pockets/mark`), which is the data: path checked here; the manifest has no `web_accessible_resources`. |
| 5 | Discarded tabs: can the icon and title swap work on them? | **fail** | `tabs.discard` on a background tab worked (`discarded: true`, status `unloaded`). The content script ping then failed with "Could not establish connection. Receiving end does not exist." `chrome.scripting.executeScript` **resolved without error**, and the injected function reported running in a live document: `href` `/discard-fresh`, `visibilityState` `"hidden"`, and `document.title` returning the new title. Yet `tabs.get`, read at most 2 s later, reported `discarded: true`, `status: "unloaded"`, the original title, and no icon. Both observations are recorded as seen; this run does not explain them (for example, whether the script woke the tab briefly or ran in some other document). What matters for the design: a resolved `executeScript` did not produce a visible swap on a discarded tab, so code must check `tab.discarded` rather than trust the result. Also observed: a tab swapped while awake and then discarded **keeps the swapped title and icon** on the tab bar. Restoring a tab that gets discarded mid-visit therefore cannot rely on the content script. |
| 5b | How often stale tabs are asleep in practice | **could not verify** | This depends on real users' memory pressure, Memory Saver settings and browsing habits. A test container cannot measure it. |

Gate (brief): assumptions 1 and 2 passed, so Phase 2 can go ahead as designed. Assumption 5 failed; its test now asserts
that recorded outcome (Chromium did not crash, the tab stayed discarded, and its title and icon were **not** swapped), so
it is green while Chromium behaves as recorded and turns red if the behaviour changes. (It was first marked `test.fail()`
with the opposite assertions; that was replaced because the list reporter shows an expected failure as a red cross.) That narrows the tab-bar part of a visit (a discarded target cannot show the swapped icon and
title) but does not block.

## Environment findings that later tasks need

- **Headless works for extensions.** `launchPersistentContext` with `channel: 'chromium'` uses the
  full Chromium binary in new headless mode, and the unpacked extension and its service worker load
  there. No display or xvfb is needed. A headed run under `xvfb-run -a` (set `POCKETS_HEADED=1`)
  gives the same five results.
- **Playwright keeps every page "visible"** (observed in an exploratory run, not reproduced by a committed test). Any tab Playwright attaches to reports
  `document.visibilityState === "visible"`, even when it is not the active tab. This happens both
  headless and headed. A real background tab therefore cannot be produced through Playwright pages.
- **`chrome.tabs.discard` crashes Chromium while Playwright is attached** (observed in exploratory runs, not reproduced by a committed test). The browser segfaults
  (`Received signal 11 SEGV_MAPERR`) about a second after the discard. This happened both headless
  and headed, and also when the tab was created by the extension rather than by Playwright. The same
  discard with no Playwright attached (a throwaway probe extension with no CDP, and the raw CDP
  helper below) does not crash. Later e2e tests must not discard tabs inside a Playwright context.
- **Raw CDP helper.** `e2e/fixtures.ts` exports `launchRawExtensionBrowser`. It starts the same
  Chromium with `--remote-debugging-pipe` and attaches **only** to the extension's service worker,
  then evaluates code there. Tests 3 and 5 use it because of the two points above. It passes
  `--disable-component-extensions-with-background-pages` so that Chromium's built-in component
  extensions do not show up as extra service workers. Headed, the worker is sometimes replaced just
  after startup, so the helper confirms the session answers before using it.
- The content-script stubs only answer `pockets/ping`. Where a test needed the content script to act,
  it ran code in the tab's isolated world with `chrome.scripting.executeScript`. That is the same
  world and the same CSP exemptions as a content script.
- Pass `--trace off` to Playwright, as required. The config also sets `trace: 'off'`.
