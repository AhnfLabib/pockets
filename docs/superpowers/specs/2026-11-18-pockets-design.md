# Pockets — design

Status: awaiting owner approval · 2026-11-18

## What it is and why

Pockets is a Chrome extension for people whose tabs pile up. A small raccoon
called Pockets crawls across the page you are on, climbs to the tab bar and
takes a tab away.

The owner built it for a problem they have themselves: dozens of tabs left
open for no reason, some of them distracting during work. Existing tab
cleaners and site blockers are stern, so people resent them and uninstall.
Pockets is meant to be something you are fond of, so you leave it on.

## Goals

- Tabs that have not been opened for a while get removed without the user
  having to do anything.
- While the user is "working", distracting tabs get removed too.
- Every removal is announced, can be stopped, and can be undone.
- The removal is fun to watch.

## Non-goals (first version)

Accounts, sync between devices, schedules or timers for working mode,
Firefox and Safari, more than one character, taking several tabs in one
visit, illustrated store-listing artwork.

## Anti-goals

These would make it a failure even if it works:

- A tab the user needed disappears with no warning and no way back.
- Pockets shows up so often that it becomes a nuisance.
- The animation gets in the way of the page (blocks clicks, steals focus,
  breaks the page's layout or styles).
- The animation looks mechanical. This was the main feedback through four
  rounds of mocks; see "Movement" below.

## Behaviour

### The two rules

1. **Stale tabs, always on.** A tab not opened for longer than the stale
   time is a target. Default 24 hours.
2. **Distracting tabs, only in working mode.** A tab on a site in the
   distracting list is a target however recently it was used. This includes
   tabs opened or navigated to a distracting site during working mode.

### Working mode

*(My call, differs from what was first agreed)* Clicking the toolbar button
opens a popup with a working-mode switch at the top, so it is two clicks,
not one. The popup is needed anyway for "add this site" and the taken list.
The toolbar icon shows which state it is in. Working mode stays on until it is
switched off, including across browser restarts.

### Distracting list

A list of sites the user controls, pre-filled with youtube.com, reddit.com,
x.com, twitter.com, instagram.com, facebook.com, tiktok.com, netflix.com.
The popup has an "add this site" button for the current tab. Matching is by
site, including subdomains.

### Never taken

- Pinned tabs, under both rules. *(My call)* Pinning is the user saying
  "keep this", so a pinned distracting site is left alone even in working
  mode.
- Tabs playing audio, under the stale rule only. *(My call)* In working
  mode a distracting site playing audio is still taken; a video playing in
  the background is the distraction.
- The tab the user is looking at in each window, unless it is a distracting
  site in working mode.
- *(My call)* Tabs where the user has typed into a form since the page
  loaded, because closing them loses work. Tabs that were already open when
  Pockets was installed or updated count as typed in until they next load a
  page, since their earlier typing is unknown. A page restored from the
  back/forward cache keeps the protection it had. Asleep (discarded) tabs,
  which cannot report anything, are treated as not typed in.
- *(My call)* Sites on a "never take" list in settings, empty by default.
- Tabs in windows the extension cannot see (incognito unless the user
  enables it).

### A visit

Pockets takes **one tab per visit**.

1. **Pick the target.** Distracting tabs first, then the stalest tab.
   *(My call)* Only tabs in the focused window are candidates. Tabs in other
   windows wait until their window is focused, so the warning and the
   tab-bar change always happen where the user is looking.
2. **Pick the stage.** The stage is the page the user is looking at, in the
   focused window. If the target is itself the tab being looked at (a
   distracting site in working mode), the stage and the target are the same.
3. **Climb.** Pockets pokes its head in at the bottom of the stage, climbs
   the left border, crosses the top and stops under the target tab's
   approximate position. Extensions cannot read where a tab sits on the tab
   bar, so the position is estimated from the tab's index and the number of
   tabs.
4. **Warn.** A card appears next to Pockets with the target's title, the
   reason ("not opened for 2 days" or "distracting"), a five-second
   countdown ring and a **Keep this tab** button. At the same time the
   target tab's icon becomes Pockets' icon and its title counts down
   ("Mine in 5…").
5. **Take or leave.**
   - Countdown ends: the tab closes. In the stage a small tab drops from the
     top edge, Pockets grabs it, crouches, and bolts off the bottom. A
     notice with **Undo** stays for about five seconds.
   - *(My call)* When the target is the page being looked at, the grab and
     the start of the bolt play first (well under a second) and then the tab
     closes, taking the stage with it. The Undo notice then appears on
     whichever tab becomes active, if that page can run extensions. The
     taken list in the popup is always the fallback.
   - **Keep this tab**: the tab's icon and title are restored and Pockets
     leaves without it. *(My call)* A kept stale tab is left alone for
     another full stale period. A kept distracting tab is left alone until
     working mode is next switched on.
   - The user switches to a **stale** target during the countdown: treated
     as Keep, without the grumpy card text.
   - *(My call)* The user switches to a **distracting** target during the
     countdown: it is not saved. The visit carries on with that page as the
     stage, and the card shows the time remaining.
   - The user leaves the stage some other way during the visit (from the
     climb until the take): see "Leaving during a visit" below.

### Leaving during a visit

*(Owner's decision, release B; replaces "switching away cancels the
visit".)* "In front" means the stage is the active tab of a focused normal
browser window. If the stage stops being in front during a visit, including
during the climb, Pockets **pauses**: he leaves the stage page, the target's
tab-bar countdown stops, and the toolbar badge shows "!".

- **Another tab inside the browser** (a browser window is still focused,
  but the stage is not its active tab, or another browser window is
  focused): nothing is taken while paused this way. Coming back to the
  stage resumes the visit: Pockets is back under the tab, the countdown
  starts again from its full length, and the card has to be on screen again
  before anything is taken. Not back within five minutes: the visit ends
  quietly, nothing is closed, and for a stale visit the gap starts.
- **Away from the browser** (no browser window focused because another app
  is in front, or the stage's window is minimised): as above, and a system
  notification fires once for that period away: "Pockets has his eye on
  “<title>”. Come back within 5 minutes to keep this tab, otherwise he'll
  steal it." Clicking it brings the stage back to the front, which resumes
  the visit. If five minutes after the notification was shown no browser
  window is focused, Pockets takes the tab without the card; the
  notification was the warning. This counts even if the user is idle or
  away from the computer. A second notification follows: "Pockets stole
  “<title>”. He ran off with it. Undo brings it back.", with an **Undo**
  button that works like the notice's. The take is recorded and paced like
  any other.
  - The user must be away from the browser the whole time since the
    warning. If any browser window is focused again (even on another tab),
    the warning is withdrawn and the visit becomes a tab-switch pause from
    that moment; leaving the browser again brings a fresh warning and a
    fresh five minutes. So at the deadline a focused browser means nothing
    is taken.
  - Both notifications stay until the user answers them. Clicking the
    "stole" notification is Undo, like its button.
  - Pockets' own toolbar popup open counts as the user being in the
    browser: the stage counts as in front if it is its window's active tab.
  - The five minutes keep counting while the computer sleeps (owner's
    decision): a deadline that passed during sleep may take on wake.
  - The notification could not be created (no permission, an error): never
    taken while away; treated as a tab switch.
  - The user clicked the notification: never taken while away for that
    pause, even if the browser did not come to the front.
  - Each period away has its own notification and five minutes: after a
    resume, leaving again warns again.
- Switching working mode off during a paused distracting visit still ends
  it. Opening the target itself keeps the rules above (stale: Keep;
  distracting: replayed with it as the stage).
- A browser restart ends a paused visit; nothing is taken.

### Pacing

- After a visit for a stale tab, Pockets waits at least five minutes before
  the next one. The gap is a setting.
- **At most four stale tabs are taken per hour** (owner's decision). The
  number is a setting. A large pile, such as on the day of install or after
  a weekend, clears over a day or two instead of in one long run of visits.
- Distracting tabs in working mode skip the five-minute wait and do not
  count toward the hourly cap. *(My call)* When several are open, Pockets
  leaves 30 seconds between them.
- *(My call)* Pockets only **starts** a visit while a Chrome window is
  focused and the user is active. A visit the user walks away from is
  handled by "Leaving during a visit": the only take while the user is away
  is the one announced by a system notification five minutes earlier.
- *(My call)* Only one visit runs at a time across all windows.

### When the full show is not possible

- **The stage cannot run extensions** (new tab page, browser settings, the
  Web Store, PDF viewer): *(my call)* no visit. Pockets waits and tries
  again when the user is on a page it can draw on. If a distracting site is
  the page being looked at, the stage is that page, so this case does not
  arise for it.
- **The safety rule** (owner's decision, release B; replaces "no tab is
  ever closed unless the warning card was shown on screen"). A tab is closed
  only if either
  1. its warning card was confirmed visible on screen at the moment of
     taking, or
  2. the user was away from the browser, a system notification about this
     exact visit and target was created at least five minutes earlier (and
     not clicked), and no browser window is focused at the moment of
     taking.

  Every other closing safeguard holds on both paths: the target is re-read
  immediately before closing (same address, not pinned, not typed into, not
  about to navigate away), it is never the only tab in its window, only the
  visit's own target is ever closed, and only one visit runs at a time. The
  "never taken" rules apply on both paths. If notifications are silenced by
  the operating system (Do Not Disturb, Focus), the browser still reports
  them as shown, so path 2 can take a tab whose warning the user did not
  see; Undo in the popup remains. Windows the extension cannot see (incognito
  unless allowed, other profiles) count as "not focused".
- **The target cannot run extensions or is asleep** (Chrome's memory saver
  discards background tabs): the climb and card play on the stage, but the
  target's icon and title cannot change. This may be frequent for stale
  tabs (not yet measured), so the card is the primary warning and the
  tab-bar change is a bonus.
- **Reduced motion is set in the OS**: no crawl. The card appears in the
  top-left with the countdown, and Pockets is drawn still beside it.

### After a tab is taken

- Taken tabs stay gone. Switching working mode off brings nothing back.
- Every taken tab is recorded: title, address, icon, time, and reason.
- **Undo** on the notice reopens the tab where it was, with its history
  where the browser allows.
- The popup shows the most recent taken tabs, each with a reopen button, and
  links to the full list. *(My call)* The list keeps the last 200.

### Settings page

Stale time, gap between visits, stale tabs per hour, countdown length,
distracting list, never
take list, and the full taken list.

## Character

**Pockets** is a raccoon and a smug thief. It never apologises.

- It wears a red neckerchief. That is the detail that stays recognisable
  from above and at small sizes.
- Voice, used in the card and notice: "Mine in 5…", "Pockets took YouTube",
  and when kept, "Fine. Keep it."
- On pages it is seen **from above**, crawling on the screen like an animal
  on a window. Its face is mostly hidden in that view; this was accepted.

### Movement

The approved reference is `docs/spikes/mock-hand-drawn.html`. The movement
in it is the specification. What makes it read as alive, all of which must
survive the rebuild:

- Each paw stays planted until the body has moved past it, then steps.
  Diagonal pairs step together.
- It moves in bursts: scurry, stop, look around, scurry. Speed eases in and
  out. The path wanders slightly and differs each time.
- The body bends through corners, shoulders and hips sway with the steps,
  the legs bend at the elbow.
- The head swings from the neck, snaps to a new direction and holds, and
  the pupils get there first. Sniffing is a quick twitch of the nose.
- The tail trails and swishes lazily when stopped. It breathes, blinks and
  twitches an ear.
- It crouches before it bolts.
- A soft shadow sits under it.

### Look

Hand-drawn: brush-ink outlines, slightly uneven flat colour, cel shading.
The body parts are painted separately, cut out with transparent
backgrounds, and placed every frame by the movement code. Each part is
painted three times with different brushwork and the three are cycled about
seven times a second, so the lines wobble like a hand-drawn cartoon.

Four known faults in the mock to fix in the real artwork:

1. The tail reads as a string of beads. It should be one tapering ringed
   tail that bends.
2. The legs are plain strokes. They should be painted like the rest.
3. A pale fringe from the painting's paper shows around some pieces.
4. The top-down face is small. Enlarge the eyes and mask as far as the
   head allows.

### Icon

Direction **B (mask)**, `docs/spikes/icons/B-mask.png`: an extreme close-up
filling a rounded tile, with the dark mask, two eyes and the nose. It was
chosen because two eyes in a dark band are still readable at 16 pixels.
The first, full-face icon was rejected.

- Sizes 16, 32, 48, 128. The small sizes use a simplified drawing with
  heavier outlines.
- The same mark is used for the toolbar button, the target tab during the
  countdown, and the notice.
- *(My call)* Working mode on and off are told apart on the toolbar icon by
  a small red badge, not by a second drawing.

## Approaches considered

### How Pockets is drawn and animated

1. **Plain shapes drawn by code.** Least work, and what the first approved
   mock used. Looks flat.
2. **Hand-drawn stills, plain-shape crawler.** Illustrated wherever Pockets
   stands still, shapes when it moves. Safe, but two looks.
3. **Hand-drawn pieces on the live rig** (chosen). Illustrated everywhere,
   and it keeps the paw-by-paw movement. The owner asked for this to be
   proven first; the test is `docs/spikes/mock-hand-drawn.html` and was
   approved ("works perfect").

Commissioned artwork played back as fixed clips was also considered and
dropped: it costs money and loses the live movement that fixed the
"robotic" feedback.

### How the animation reaches the tab bar

1. **Draw over the page, hand over to the tab's icon and title** (chosen).
   The only route a browser extension has. The jump off the top edge hides
   the handover.
2. **A separate desktop app drawing over the browser.** Would let Pockets
   walk on the real tab bar. Rejected: far larger, fragile, and not an
   extension.

The owner originally wanted Pockets on the tab bar itself. That is not
possible for an extension; approach 1 was shown in mocks and accepted.

## How it is built (my calls unless marked)

The owner handed over the technical choices.

- **Platform:** Chrome extension, Manifest V3. It should also load in Edge,
  Brave and Arc; only Chrome is tested.
- **Language and tools:** TypeScript, bundled with esbuild, unit tests with
  Vitest, one end-to-end smoke test with Playwright loading the unpacked
  extension.
- **Parts:**
  - *Background service worker*: decides when to visit and which tab,
    drives the visit as a small state machine, closes tabs, keeps the taken
    list. Wakes on a one-minute alarm and on tab events.
  - *Content script* on all sites: reports whether the user has typed into
    a form, changes its own tab's icon and title on request, and hosts the
    stage.
  - *Stage*: a full-viewport canvas plus the card and notice, inside a
    shadow root so page styles and extension styles cannot affect each
    other. The canvas ignores the pointer; only the card and notice take
    clicks. It never takes keyboard focus.
  - *Popup* and *settings page*.
- **Rules as pure functions.** Choosing a target, deciding whether a visit
  is allowed now, and matching a site against a list take plain data and
  return plain data, so they are unit-tested without a browser.
- **Stale time** comes from the browser's own last-accessed time for each
  tab.
- **Permissions:** tabs, storage, alarms, idle, sessions, scripting,
  notifications, and access to all sites. Access to all sites is required to draw on whatever
  page the user is on. It triggers a longer Web Store review and a strong
  install warning; this is a cost of the concept.
- **Privacy:** nothing leaves the machine. No network requests, no
  analytics.
- **Storage:** settings and the taken list in the extension's local storage.
- **Artwork pipeline:** a Python script in `tools/art/` paints the sprite
  sheets and icons using the drawing library from
  github.com/cloveric/claude-drawing-skill (MIT, vendored at a pinned
  commit, only the files used). The generated PNGs are committed, so
  building the extension does not need Python.
- **First milestone is the character on its own.** Before any extension
  wiring, the builder produces a standalone page with the final artwork and
  movement (including the four artwork fixes, which need new drawing code
  for the tail and legs, not only repainting). The owner judges it against
  the mock and approves it before work continues. The owner is the only
  judge of whether it looks alive.
- **Rebuild, do not copy.** The mock's movement code is the reference, but
  it is rewritten as tested modules. The mock stays in `docs/spikes/`.

## To verify first

These browser behaviours are assumed above and have not been run in a real
extension. An early task in the plan loads a bare extension and checks each
one. If any fails, come back to the design before building on it.

- A tab's last-accessed time survives a browser restart and session
  restore. If it resets, the stale rule needs its own record of when each
  tab was last opened, which changes the stored data.
- Undo can reopen a closed tab in its old position with its history.
- A background tab that is awake can change its own icon and title, and the
  change shows on the tab bar.
- The stage can be drawn over pages with a strict content security policy.
- How often stale tabs are asleep in practice.

## Left to the builder

- Exact wording of card, notice, popup and settings text, in Pockets' voice.
- Layout and styling of the popup and settings page.
- The formula for estimating the target tab's position.
- How the three brushwork variants are packed into sprite sheets.
- Tuning numbers for the movement, as long as it matches the mock.
- File and module layout.

## Out of scope, to revisit

- Publishing to the Chrome Web Store, including the name check.
- Illustrated store artwork (icon direction A, "peek", was liked for this).
- Taking several tabs per visit.
