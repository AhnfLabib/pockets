# Pockets

Pockets is a raccoon who lives in Chrome and takes your tabs.

Every so often it pokes its head in at the bottom of the page you are on, climbs the left edge, crosses to
under the tab it has its eye on and says so: "Mine in 5…". The tab's own title counts down with it. If you do
nothing, the tab is gone and Pockets bolts off the bottom of the screen with it. It never apologises.

- **Stale tabs, always.** A tab you have not opened for 24 hours is fair game.
- **Distracting tabs, while you are working.** Switch working mode on from the toolbar button, and tabs on your
  distracting list (YouTube, Reddit, X and friends, editable) are taken however recently you used them.
- **One tab per visit,** at most four stale tabs an hour, with at least five minutes between visits.
- **Never without warning.** A tab is closed only if its warning card was on screen at that moment, or, when you
  left the browser during a visit, a system notification warned you five minutes earlier (see below). **Keep this
  tab** sends Pockets away empty-handed. **Undo** on the notice puts a taken tab back where it was, with its history.
  The popup and the settings page list everything Pockets has taken, with a button to reopen each.
- **Leaving during a visit.** Switch to another tab and Pockets waits (the toolbar badge shows **!**): come back
  and the countdown starts again from the top, with the card back on screen; stay away five minutes and he gives up.
  Leave the browser altogether (another app in front, or every browser window minimised) and a system notification says
  "Pockets has his eye on …": come back within five minutes, or click the notification, to keep the tab. Coming back
  to the browser at all, even to another tab, withdraws the warning (Pockets then waits as for a tab switch, and
  leaving again starts a new warning and five minutes). Otherwise he takes it without the card, even if you are away
  from the computer, and a second notification offers **Undo** (its button or a click on it). Both notifications stay
  until you answer them. Pockets' own toolbar popup counts as being in the browser (and as the page being in front
  only when it is opened in that page's window).
- **Never taken:** pinned tabs, the tab you are looking at (unless it is distracting and you are working), tabs
  playing sound (stale rule only), tabs you have typed into, and sites on your "never take" list.

## Build and test

Needs Node.js (developed with 22).

```
npm install
npm run build          # bundles the extension into dist/ and the character page into dist-harness/
npx vitest run         # unit tests
npx tsc --noEmit       # type check
```

The end-to-end tests drive real Chromium with the extension loaded. On a fresh checkout, download Playwright's
Chromium once first:

```
npx playwright install chromium
```

They need a test build, which compiles in a test-only hook (`pockets/test-set`) that shortens the timings:

```
POCKETS_TEST=1 npm run build
npm run e2e -- --trace off
```

The same hook can shorten the five-minute pause grace period and stand in for "no browser window is focused", which
headless Chromium cannot produce, and the test build exposes the notification handlers so a test can press Undo.
In a test build the content script's liveness check also reads `__pocketsTestOrphan` from its isolated world, so a test
can orphan it the way an extension reload does without killing the service worker.
A normal `npm run build` leaves all of it out (`grep -rE "pockets/test-set|__pocketsTestSet|__pocketsNotification|pocketsTest" dist` finds nothing), so always
run a normal build before loading or packaging the extension. `POCKETS_HEADED=1` runs the browser with a window
(under `xvfb-run -a` on a machine with no display).

## Install in Chrome (unpacked)

1. Run `npm install` and then `npm run build`. This writes the extension to the `dist/` folder.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (the switch at the top right).
4. Click **Load unpacked** and choose the `dist/` folder inside this project. Choose `dist/` itself, not the project
   folder and not `dist-harness/`.
5. Chrome warns that Pockets can "read and change all your data on all websites". That is the all-sites access
   explained below. Pockets appears in the list.
6. Click the puzzle-piece icon on the toolbar and pin Pockets, so its raccoon face is always visible. Clicking it
   opens the popup with the working-mode switch and the recently taken tabs. A small red badge on the icon means
   working mode is on.
7. Optional: right-click the icon and choose **Options** to change the stale time, the gap between visits, the
   number of stale tabs per hour, the countdown, and the distracting and "never take" lists.

Tabs that were already open when Pockets was installed or updated get Pockets' page code added straight away
(web pages only; Chrome's own pages, the Web Store and sleeping (discarded) tabs cannot take it). They can be the page
Pockets is drawn on at once. Pockets cannot know whether you typed into such a page before it arrived, so it treats
each of them as typed in: a tab that was open at install is never taken as stale or distracting until it next loads
a page (a reload, or going to another address). A sleeping tab gets the code when it wakes and reloads, and counts as
not typed in. Re-enabling Pockets after turning it off does not add the code to open tabs; reload them, or they stay
without Pockets until they next load a page.

After changing the code, run `npm run build` again and click the reload arrow on Pockets' card in
`chrome://extensions`.

## The character page

`dist-harness/character.html` shows Pockets on its own, playing whole visits over a fake page: the crawl, the card,
the take, and Keep (press it yourself, or let the page press it for you). It is not part of the extension. After `npm run build`,
open it straight from disk, for example:

```
xdg-open dist-harness/character.html      # Linux
open dist-harness/character.html          # macOS
```

or drag the file into a Chrome window. It reads its icons from `assets/` in the project, so open it from inside the
project folder.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `tabs` | To see each tab's address, title, icon, pinned and audio state, and when it was last opened, which is what makes a tab stale. And to close the tab Pockets takes. |
| `storage` | To keep your settings, whether working mode is on, and the list of taken tabs, in Chrome's local extension storage on this computer. |
| `alarms` | To wake Pockets once a minute to check whether a visit is due. Chrome's extension background stops when idle, so a timer alone would not survive. |
| `idle` | To start a visit only while you are at the computer. (A visit you walk away from is handled by the notification below, not by `idle`. The five minutes keep counting while the computer sleeps: if they ran out during sleep, the tab is taken when it wakes.) |
| `notifications` | To warn you before taking a tab while you are away from the browser, and to offer Undo afterwards. |
| `sessions` | For **Undo** and **Reopen**: restoring a taken tab through Chrome's recently-closed list brings it back in its old place with its back and forward history. |
| `scripting` | When Pockets is installed or updated, tabs that are already open have none of its page code (Chrome only adds declared content scripts to pages that load afterwards). Pockets adds it to those open web pages once, so they can show Pockets without being reloaded. |
| All sites (`<all_urls>`) | Pockets is drawn on top of whatever page you are looking at, the countdown is shown on the target tab's own title and icon, and each page reports whether you have typed into it. That needs Pockets' content script on every site. |

## Privacy

Nothing leaves your computer. Pockets makes no network requests, has no analytics and no account. Settings and the
taken list (title, address, icon, time and reason of each taken tab, the last 200) stay in Chrome's local storage
for the extension. Typing is only noticed as "this tab has been typed into"; what you type is never read or kept.
Uninstalling Pockets removes all of it.

## Known limitations

- **Notifications must be allowed.** On macOS, allow notifications for your browser in System Settings →
  Notifications, or the away warning cannot appear. If Chrome cannot show the notification at all, Pockets never
  takes a tab while you are away (the visit ends quietly after five minutes). But if notifications are silenced by
  the operating system or by Focus / Do Not Disturb, the browser still reports them as shown, so a tab can be taken
  without you seeing the warning. Undo in the popup still brings it back.
- **Windows Pockets cannot see count as "away".** An incognito window (unless you allowed Pockets in incognito) or a
  window of another Chrome profile is invisible to the extension. Working in one during a visit looks like having left
  the browser: the warning notification fires, and the tab is taken five minutes later unless you come back.

- **Sleeping tabs cannot show the face or the countdown on the tab bar.** Chrome's Memory Saver puts background
  tabs to sleep, and a sleeping tab runs no page code. Pockets still warns with the card on the page you are
  looking at, which is the main warning, but the target's own title and icon do not change.
- **A tab marked and then put to sleep keeps the mark until it wakes.** If Chrome puts the target to sleep during
  the countdown, or after a visit was cut short, it keeps Pockets' face and "Mine in…" title on the tab bar until
  you open it again, when the page reloads with its own.
- **Pages Chrome does not let extensions draw on** (the new tab page, `chrome://` pages, the Web Store, the PDF
  viewer): Pockets does not visit while one of these is in front. It waits until you are on an ordinary page.
- **The tab position is estimated.** Extensions cannot read where a tab sits on the tab bar, so Pockets stops under
  where the tab probably is, worked out from its position and the number of tabs.
- **Only Chrome is tested.** It may load in Edge, Brave or Arc, but nobody has checked.

## Credits and licence

The artwork is painted by `tools/art/paint.py` (see `tools/art/README.md`) using two files vendored unchanged from
[cloveric/claude-drawing-skill](https://github.com/cloveric/claude-drawing-skill) at commit
`6af36dc717b63d6ddafb54d2eaa120cacd99ab4d`: `tools/art/vendor/cartoon.py` and `tools/art/vendor/core.py`. They are
© 2026 cloveric under the MIT licence, whose full text is in `tools/art/vendor/LICENSE`. The generated sprite sheets
and icons are committed, so building the extension does not need Python.
