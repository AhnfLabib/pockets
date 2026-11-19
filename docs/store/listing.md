# Chrome Web Store listing: Pockets: the tab-stealing raccoon

Everything below is ready to paste into the Chrome Web Store developer dashboard.

## Store listing tab

**Name** (comes from the manifest): Pockets: the tab-stealing raccoon

**Summary** (manifest description, 132 characters max):
A hand-drawn raccoon who takes the tabs you forgot about. Warns you first, lets you keep them, and gives them back if you ask.

**Category:** Productivity → Workflow & Planning

**Language:** English

**Description:**

Forty tabs open and half of them are from last week? Pockets takes care of it.

Pockets is a small hand-drawn raccoon in a red neckerchief. When a tab has sat unopened for a day, he pokes his head in at the bottom of the page you are on, climbs up to the tab bar, and gives you five seconds' warning. Leave it, and he grabs the tab in his mouth and runs off with it. Change your mind, and Undo brings it straight back.

HOW IT WORKS
• Tabs you haven't opened for a day get taken, one at a time.
• Turn on working mode from the toolbar and distracting sites (YouTube, Reddit, X and others you choose) get taken too.
• Every visit comes with a countdown and a "Keep this tab" button.
• Every taken tab can be reopened, from the notice or from the list in the popup.

WHAT POCKETS NEVER TAKES
• Pinned tabs
• Tabs you have typed into, so unsaved work is safe
• The only tab in a window
• Tabs playing sound (unless they are distracting and you are working)
• Sites on your "never take" list

HE ISN'T A NUISANCE
• At most four forgotten tabs an hour, at least five minutes apart.
• Only while you are actually at the computer.
• If you switch away during the countdown, he backs off.

YOU'RE IN CHARGE
Change how long before a tab counts as forgotten, how often he visits, the countdown, and both site lists in the settings.

PRIVATE BY DESIGN
Everything stays in your browser. No accounts, no servers, no tracking, no network requests at all.

Prefers less motion? With "reduce motion" switched on in your system settings, Pockets skips the climb and shows the warning card straight away.

**Graphics:**
- Icon: `assets/icons/icon-128.png`
- Screenshots (1280×800): `docs/store/screenshot-1-climb.png`, `docs/store/screenshot-2-countdown.png`, `docs/store/screenshot-3-getaway.png`, `docs/store/screenshot-4-popup.png`
- Small promo tile (440×280): `docs/store/promo-440x280.png`

## Privacy practices tab

**Single purpose:**
Pockets closes tabs the user has not used for a while, and distracting tabs while the user's working mode is on, after showing an animated warning that lets the user keep the tab, and lets the user reopen any tab it closed.

**Permission justifications:**
- **tabs:** Reads the open tabs' addresses, titles, pinned and audio state and last-used time to choose which tab to take, and closes that tab.
- **storage:** Keeps the user's settings and the list of taken tabs (for reopening) in local extension storage on the user's computer.
- **alarms:** Checks once a minute whether a tab is due to be taken.
- **idle:** Visits only while the user is active, so the warning is never shown to an empty room.
- **sessions:** Reopens a taken tab in its original position with its history when the user presses Undo.
- **scripting:** Adds the extension's content script to tabs that were already open when the extension was installed or updated, so they can show the warning without being reloaded.
- **Host permission (all sites):** The warning animation and countdown card are drawn on whatever page the user is viewing, which can be any site. The same script notices when the user types into a form, so that tab is protected from being closed. No page content is read beyond whether typing occurred, and nothing is sent anywhere.

**Remote code:** No, I am not using remote code. All code is packaged in the extension.

**Data usage:** Pockets does not collect or transmit user data. Tick none of the data categories. Certify:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/AhnfLabib/pockets/blob/main/PRIVACY.md (works once the pull requests are merged into `main`).

## Distribution tab

- Visibility: Public (or Unlisted for a soft launch).
- Regions: All regions.
- Pricing: Free.
