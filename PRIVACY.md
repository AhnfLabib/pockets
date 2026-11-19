# Privacy policy for Pockets: the tab-stealing raccoon

Last updated: 19 November 2026

Pockets is a browser extension that closes tabs you have not used for a while, and, when you turn on working mode, tabs on sites you have marked as distracting. Before closing a tab it shows an animated warning on the page you are looking at, so you can keep the tab.

## The short version

Pockets does not collect, send, sell or share any of your data. Everything it keeps stays in your browser on your own computer. It has no servers, no accounts, no analytics and no advertising.

## What Pockets reads

To decide which tab to take, Pockets reads information your browser already has about your open tabs: their address, title, icon, whether they are pinned or playing sound, and when you last looked at them. It reads this inside your browser and does not send it anywhere.

To avoid closing a tab with unsaved work, Pockets notices whether you have typed into a form on a page. It records only that typing happened in that tab. It never reads, records or stores what you typed.

To visit only while you are at the computer, Pockets asks your browser whether you have been active in the last minute. It does not record your activity.

## What Pockets stores

Pockets stores the following in your browser's local extension storage (`chrome.storage.local`), on your computer only:

- Your settings: how long before a tab counts as unused, how often Pockets may visit, the countdown length, and your lists of distracting sites and sites never to take.
- A list of the tabs Pockets has taken, so you can reopen them: each tab's title, address, icon address, when it was taken and why. The list keeps the 200 most recent entries and older ones are deleted automatically.
- Working state: whether working mode is on, which open tabs you chose to keep, and which open tabs you have typed into. These refer to tabs by your browser's temporary tab numbers.

This data is not synced to other devices. Removing the extension deletes it.

## Network access

Pockets makes no network requests. The only files it loads are its own drawings, which are packaged inside the extension.

## Permissions and why Pockets needs them

- **Tabs:** to see your open tabs and close the one it takes.
- **Access to all sites:** to draw Pockets and the warning card on whatever page you are looking at, and to notice typing so it can protect that tab.
- **Storage:** to keep your settings and the list of taken tabs on your computer.
- **Alarms:** to check once a minute whether a tab is due.
- **Idle:** to visit only while you are using the computer.
- **Sessions:** to reopen a taken tab in its original place, with its history, when you press Undo.
- **Scripting:** to add Pockets to tabs that were already open when it was installed, so they work without reloading.

## Children

Pockets is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, the new version will be published at the same address with a new date.

## Contact

Questions about this policy can be raised as an issue at https://github.com/AhnfLabib/pockets/issues.
