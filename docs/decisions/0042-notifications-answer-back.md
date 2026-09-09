# 0042 — Notifications fire when nobody is looking, and answer back

- Status: accepted
- Date: 2026-09-08
- Extends: [0037](0037-a-desktop-shell-for-what-the-browser-cannot-reach.md) — the bridge grows two keys; the words stay the web app's
- Answers: the desktop half of [#202](https://github.com/natrontech/wattroom/issues/202), raised again by the first installed build ([#296](https://github.com/natrontech/wattroom/issues/296))

## Context

The app has had a notification module since #202 — chat, arrivals, a session
starting, a poke — and nothing ever switched it on: no screen called its
`enable()`, so it fired for nobody, browser or shell. It also counted only a
_hidden_ tab as "not looking", which in a desktop app is wrong twice over: a
window open behind a film is visible and unfocused, and that is exactly the
rider who needs the tap on the shoulder. The desktop shell, for its part,
denied the permission outright.

Discord sets the bar a desktop app is measured against: it notifies when the
window is not in front, a click lands in the conversation, and on macOS you
answer from the notification itself.

## Decision

**"Not looking" is hidden or not the front window.** `document.hidden ||
!document.hasFocus()`, in the browser and the shell alike. A focused, visible
room speaks for itself and gets a toast; everything else gets the OS.

**On by default in the shell, a switch in the browser.** Whoever installed an
app expects it to tap them on the shoulder; the shell grants the permission
itself, so there is no prompt to gate behind a gesture. A browser needs that
gesture, so the profile gains the switch that never existed. Off is remembered
on the device either way.

**A notification carries where it came from.** Every push names a path on our
origin; a click lands there. In the shell the notification is the shell's own,
because Electron's main-process `Notification` can do what the renderer's
cannot: carry a reply field on macOS and hand the click back to the app. A DM
answers through the same request the thread uses; a room's chat answers on the
live connection. The shell clips every string and accepts only a same-origin
path — remote content chooses the words, never where the app goes.

## Consequences

- Two bridge keys, `notify` and `onNotification`; the web app decides
  _whether_, the shell decides _how_, and neither knows the other's rules.
- A rider in a room they are not connected to, and a friend request, get a
  click but no reply field: there is no connection to answer on, and no
  message to answer.
- Windows and Linux get the click; the reply field is macOS. When Electron
  grows it elsewhere, nothing here changes but the platform note.
