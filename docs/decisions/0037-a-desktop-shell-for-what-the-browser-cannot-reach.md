# 0037 — A desktop shell for what the browser cannot reach; the web app stays the product

- Status: accepted
- Date: 2026-09-08
- Amends: [0004](0004-chrome-first-with-native-escape-hatch.md) — its "until a
  trigger fires: no wrapper work, no dual distribution" clause, on the terms
  0004 itself set
- Constrained by: WATTROOM.md's **iOS row — "web-only, forever"**, which this
  does not touch, and [0019](0019-tagged-releases-and-a-self-converging-vm.md),
  whose CalVer tags this deliberately does not share *(amended below: the
  scheme is shared, the tags are not)*
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
  *tab* audio on every platform, and full system audio on Windows when the
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
  runs the ride's clock on a worker so it keeps firing in a hidden tab, *and*
  reports elapsed wall-clock seconds so the ride advances correctly even if the
  worker is throttled anyway. `server-clock.ts`, `game-cues.ts`, `mic-level.ts`
  and `JukeboxDock.svelte` each handle throttling on their own terms.

A shell justified on those would be claiming credit for work the browser build
already did, and would leave the real justification — two capabilities, not
five — undefended. The shell may still *improve* them. It is not why it exists.

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
   by installing is an addition; a *link* that requires installing is a
   regression, and is out of bounds.
3. **The web app feature-detects.** `window.wattroom?.…` absent means browser
   behaviour, so there is no version negotiation between shell and app, and no
   build in which the two can disagree.
4. **A separate version namespace.** `desktop-v*` tags, deliberately uncoupled
   from ADR-0019's CalVer release tags: the VM converges on the newest server
   release, and the shell must not be dragged along by a deploy that changed no
   native code. *(Amended below: the numbers inside that namespace are CalVer
   too.)*

**macOS is signed and notarized from the first build; Windows ships unsigned
until it costs installs.** The Apple membership is already held, and on macOS
signing is not a polish step — TCC attribution gates Bluetooth and the
microphone, so an unsigned build risks a trainer and a mic that fail *silently*,
which is the worst failure mode this product has. Windows keeps the SmartScreen
prompt and pays for it in the download page's copy. Revisit trigger for Windows:
the first installer handed to someone outside the training circle, or the first
person who bounces off it.

**Updates are an in-app nudge, never an OS auto-updater, and never mid-ride.**
A thin shell changes a few times a year; a quiet banner that links to the
release page is proportionate, and `ux.md` forbids interrupting a rider
mid-interval regardless.

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
  explicitly.** Its permission handler defaults to *allow*, and it ships no
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
major, a minor or a patch. What a rider or an operator wants to know is *when*
this build is from, and whether it is older than the one on the download page.

So the shell's versions are `YYYY.0M.MICRO`, exactly the server's scheme, and
`make desktop-release` computes the number the way `make release` does — from
the tags that already exist. What decision 4 above protects is unchanged and
still holds: the tags live in their own `desktop-v` namespace, the workflow
runs only on those, and a server release never produces a shell release. Two
trains, one calendar. `desktop-v0.1.0` was deleted with zero downloads and
replaced by `desktop-v2026.09.1`.

One wrinkle, accepted: electron-builder parses the version as semver, which
forbids a leading zero, so the installer file names and the bundle's own
version string read `2026.9.1`. The tag, `desktop/package.json` and the update
notice carry `2026.09.1`. It is the same number, the download page finds
installers by extension, and the notice compares numerically — the
`2026.9.1`/`2026.09.1` pair is tested equal.
