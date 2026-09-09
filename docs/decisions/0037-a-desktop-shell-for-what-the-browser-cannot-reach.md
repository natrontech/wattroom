# 0037 — A desktop shell for what the browser cannot reach; the web app stays the product

- Status: accepted
- Date: 2026-09-08
- Amends: [0004](0004-chrome-first-with-native-escape-hatch.md) — its "until a
  trigger fires: no wrapper work, no dual distribution" clause, on the terms
  0004 itself set
- Constrained by: WATTROOM.md's **iOS row — "web-only, forever"**, which this
  does not touch, and [0019](0019-tagged-releases-and-a-self-converging-vm.md),
  whose CalVer tags this deliberately does not share _(amended below: the
  scheme is shared, the tags are not)_
- Answers: [#296](https://github.com/natrontech/wattroom/issues/296)

## Context

[ADR-0004](0004-chrome-first-with-native-escape-hatch.md) settled that the
browser is the platform and parked all wrapper work behind three named triggers.
It was right to: a native app would have added signing, notarization, updates and
a second distribution channel before the product hypothesis was validated.

**Trigger 3 has fired — "the app needs OS capabilities the web can't grant" —
but on a narrower front than #296 claims, and the difference matters.**

What the browser genuinely cannot do:

- **ANT+.** Web Bluetooth is BLE only. An ANT+ stick speaks a proprietary
  protocol over USB, behind a vendor driver that claims the device. There is no
  web path, which is why ADR-0004 named ANT+ in trigger 3 itself.
- **System audio on macOS.** Precisely: Chrome's `getDisplayMedia` captures
  _tab_ audio on every platform, and full system audio on Windows when the
  rider shares a screen. The gap is macOS, where Chrome offers no system-audio
  capture at all. Narrower than "impossible in a browser" — and worth stating
  narrowly, because an overstated premise is one counter-example away from
  being used to reverse this.

**What does not support the trigger, contrary to #296's framing.** The issue
lists "hold the machine awake through an interval, keep running when hidden"
among the things a browser tab cannot do, and cites wake-lock and
background-throttling as unreliable. Both are solved in this repo already:

- [`web/src/lib/workout/wakelock.ts`](../../web/src/lib/workout/wakelock.ts)
  (#58) holds a screen wake lock and re-requests it on every return to
  visibility, working around the exact trap — the browser drops the lock when
  the document hides and never restores it.
- [`web/src/lib/workout/ticker.ts`](../../web/src/lib/workout/ticker.ts) (#51)
  runs the ride's clock on a worker so it keeps firing in a hidden tab, _and_
  reports elapsed wall-clock seconds so the ride advances correctly even if the
  worker is throttled anyway. `server-clock.ts`, `game-cues.ts`, `mic-level.ts`
  and `JukeboxDock.svelte` each handle throttling on their own terms.

A shell justified on those would be claiming credit for work the browser build
already did, and would leave the real justification — two capabilities, not
five — undefended. The shell may still _improve_ them. It is not why it exists.

## Decision

**Build a desktop shell that loads the deployed web app, and keep the browser a
first-class surface.** ADR-0004's Electron-versus-Tauri comparison already
decided the how and still holds: WKWebView has no Web Bluetooth, so Tauri means
rewriting the BLE transport behind `Trainer`. Electron runs the existing app
unchanged. The shell is a window, a permission boundary and a set of OS
handlers — not a fork of the app.

Four things this fixes in place:

1. **The shell holds no product code.** It loads the remote origin, so the web
   UI ships on every server deploy exactly as today and a desktop release
   happens only when native code changes.
2. **Every link works without the app.** Share, spectator and invite links open
   in a browser and always will. This is what keeps ADR-0004's actual holding
   — "click this link to spectate/join is a core product loop that only the web
   delivers" — true rather than nominal. A capability that can only be reached
   by installing is an addition; a _link_ that requires installing is a
   regression, and is out of bounds.
3. **The web app feature-detects.** `window.wattroom?.…` absent means browser
   behaviour, so there is no version negotiation between shell and app, and no
   build in which the two can disagree.
4. **A separate version namespace.** `desktop-v*` tags, deliberately uncoupled
   from ADR-0019's CalVer release tags: the VM converges on the newest server
   release, and the shell must not be dragged along by a deploy that changed no
   native code. _(Amended below: the numbers inside that namespace are CalVer
   too.)_

**macOS is signed and notarized from the first build; Windows ships unsigned
until it costs installs.** The Apple membership is already held, and on macOS
signing is not a polish step — TCC attribution gates Bluetooth and the
microphone, so an unsigned build risks a trainer and a mic that fail _silently_,
which is the worst failure mode this product has. Windows keeps the SmartScreen
prompt and pays for it in the download page's copy. Revisit trigger for Windows:
the first installer handed to someone outside the training circle, or the first
person who bounces off it.

**Updates are an in-app nudge, never an OS auto-updater, and never mid-ride.**
A thin shell changes a few times a year; a quiet banner that links to the
release page is proportionate, and `ux.md` forbids interrupting a rider
mid-interval regardless. _(Amended below, 2026-09-09: the shell updates
itself; "never mid-ride" stands.)_

## Consequences

- **The research this rests on is not in the repo, and the build cannot start
  until it is.** #296 cites `RESEARCH.md §14` throughout — the four mandatory
  Electron handlers, the TCC and entitlements traps, login items, media keys.
  On `main` §14 is the social-stats research (#994); the desktop §14 lived on
  `claude/desktop-app-planning-aa6eae`, which was never merged and no longer
  exists on the remote. The substance survives in #296's body, unsourced. It
  must land in `RESEARCH.md` **before the `desktop/` skeleton PR**, because the
  implementation depends on specifics — entitlement lists, an electron-builder
  version with a silent-microphone report — that an issue body is not a home
  for. This ADR deliberately rests only on ADR-0004's own trigger list and on
  code in this repo.
- **A second toolchain and a second release channel.** Node plus
  electron-builder, macOS and Windows CI runners, and a public releases repo
  carrying the bandwidth. Electron ships a major roughly every eight weeks and
  the shell renders remote content, so a stale Chromium is a live CVE surface:
  keeping the shell on the current major is a maintenance commitment, not a
  nice-to-have.
- **Electron's defaults are unsafe for remote content and must be closed
  explicitly.** Its permission handler defaults to _allow_, and it ships no
  Bluetooth chooser at all, so `requestDevice()` never resolves without a
  handler. These are not polish items — one is a known CVE shape and the other
  is the trainer not connecting. They are the skeleton PR's actual content.
- **iOS is untouched.** WATTROOM.md's "web-only, forever" row is locked and this
  decision does not reach it. Tauri remains the only credible iOS path if that
  is ever revisited, and choosing Electron here does not foreclose it — the
  `Trainer` interface is still the seam that would make it possible.
- **What would reverse this:** the shell failing to deliver either capability
  that justifies it. If ANT+ stays unbuilt and macOS system audio proves
  unworkable through ScreenCaptureKit at whatever Electron major is pinned,
  then the shell is ~120 MB per platform and two signing pipelines bought for
  convenience, and convenience is what ADR-0004 declined to pay for.

## Amendment, 2026-09-08 (#296): the shell counts in CalVer too

The first release went out as `desktop-v0.1.0`, and the number was wrong for
the same reason ADR-0019 gave up on semver: nothing about a thin shell has a
major, a minor or a patch. What a rider or an operator wants to know is _when_
this build is from, and whether it is older than the one on the download page.

So the shell's versions are `YYYY.0M.MICRO`, exactly the server's scheme, and
`make desktop-release` computes the number the way `make release` does — from
the tags that already exist. What decision 4 above protects is unchanged and
still holds: the tags live in their own `desktop-v` namespace, the workflow
runs only on those, and a server release never produces a shell release. Two
trains, one calendar. `desktop-v0.1.0` was deleted with zero downloads and
replaced by `desktop-v2026.09.1`.

One difference from the server's spelling, learned the hard way: **the month
is not zero-padded.** Everything that reads the shell's version parses it as
semver — electron-builder, electron-updater, Squirrel — and semver forbids a
leading zero. `2026.09.4` built and shipped, and the first build carrying the
updater crashed at launch on it (#1303). So the desktop's CalVer is
`2026.9.5`, in the tag and in `package.json` alike, and the release script
counts this month across both spellings so the numbering never goes
backwards. The server keeps `2026.09.51`; the update notice compares
numerically and treats the two forms of one number as equal.

## Amendment, 2026-09-09 (#1303): the shell updates itself

"A few times a year" lasted one day: four shell releases shipped on
2026-09-08, each a download and a drag to Applications for the one person
using it. The nudge was proportionate to a shell that never changes and
wrong for one that is being built.

So the shell carries `electron-updater`: it asks the releases repo on launch
and every few hours, downloads the next release in the background, and
installs it when the rider restarts, or quietly on quit. The home-page nudge
becomes _Restart to update_ once a download is ready. **Never mid-ride
stands**: the install is the rider's click on home, which a ride never shows,
and a download in the background costs a ride nothing.

Two consequences the pipeline pays. The feed is GitHub's
`releases/latest/download` alias through the generic provider, which is what
lets the tags stay `desktop-v<CalVer>` rather than the `v<semver>` the GitHub
provider parses. And a release now carries what the updater reads beside the
installers — the manifests, the blockmaps, and on macOS a `.zip` next to the
`.dmg`, because Squirrel.Mac installs from the zip. The first build with the
updater cannot itself be reached by it; the one before has none.

## Amendment, 2026-09-09 (#1699): the machine's sound is offered, not assumed

The shell answered every `getDisplayMedia` with `audio: 'loopback'` alongside
the picture — #1124's reading of "system audio into the room". A rider
reported the result from Windows: sharing one window sent the whole machine.

Loopback has no per-window tap. It is the output device: the rider's
notifications, whatever else they have playing, and the room's own voices and
jukebox, delayed and sent back into the room they came from. Chrome at least
puts that on screen as a checkbox in its own picker; an app-supplied picker
that asks nothing is the shell being more aggressive than the browser it
wraps, on the one platform where the Context above says the browser was
already enough. **The picker asks. Off unless it is ticked, and worded for
what the tap actually takes** — the rider chose a window, and the machine is
more than they chose.

It asks on Windows only, which is the honest half of the same point. This
handler runs on macOS only below 15 — above it the system picker takes over
and asks for audio itself — and an app-supplied picker there gets a loopback
track with no data in it ([electron#52738](https://github.com/electron/electron/issues/52738)),
so the room was being told it could hear a machine it could not. Linux
Chromium has no loopback at all. macOS system audio, the capability that
justified this ADR, is unaffected: it arrives through the system picker.

## Amendment, 2026-09-09 (#1751): the room asks where the shell cannot

The amendment above ends by saying macOS system audio "arrives through the
system picker". It does — unasked. `SCContentSharingPicker` has no audio
checkbox to offer, and with `useSystemPicker` the shell's own handler is never
called, so #1699's question is one macOS riders were never put. The report
came back the way it was always going to: the machine's sound went with every
share, and there was nothing anywhere to turn it off.

The shell cannot fix this where it happens. **The app can, because the app is
what publishes the audio**: a share's sound is a LiveKit track like any other,
and whether the room gets one is the renderer's decision, not the picker's.
So the question moves to the one surface that exists on every platform — the
share notice (#563), which is already persistent, already on every page, and
already the thing that says what the room can see.

- **Off is instant, and it closes the tap.** The track is unpublished *and*
  stopped, so the machine stops being tapped rather than being tapped quietly.
  A rider pressing it means "not this", and must not wait on a picker.
- **On re-runs the share, picker and all.** `getDisplayMedia` has no
  audio-only form; a capture that did not take the sound cannot grow one.
- **The answer is remembered per device, and it defaults to on.** Every picker
  that *does* ask — Chrome's "share tab audio", the shell's Windows checkbox —
  has the rider's answer already, and defaulting to off would silently
  overrule the box they ticked. What was wrong was never that the sound went;
  it was that it went every time with no way to say no.
