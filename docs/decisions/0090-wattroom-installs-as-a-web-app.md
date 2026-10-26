# 0090 — WattRoom installs as a web app: a manifest, home-screen icons, safe areas, no service worker

- Status: accepted
- Date: 2026-10-26
- Answers: [#4204](https://github.com/natrontech/wattroom/issues/4204)
- Beside: [0004](0004-chrome-first-with-native-escape-hatch.md) and [0037](0037-a-desktop-shell-for-what-the-browser-cannot-reach.md) (the desktop shell stays the way past the browser on a computer)

## Context

Jan added WattRoom to his iPhone's home screen on iOS 27 and sometimes got Safari's back and forward bar inside it. The site had no web app manifest. Without one, iOS takes an installed app's scope from the page it was added from, so an app added on `/crew/x/…` treated every other path as leaving the app and drew Safari's controls. The home-screen icon was `favicon.png`, a rounded tile with a transparent margin, which iOS fills with black. And the viewport left the notch and the home indicator to the browser, so an app drawn full screen could not reach the edges or keep its controls clear of them.

A phone is where a rider reaches WattRoom away from the bike: chat, the crew, the phone remote ([#3217](https://github.com/natrontech/wattroom/issues/3217)), a controller beside the riding screen ([0089](0089-one-rider-one-voice.md)). It should open like an app.

## Decision

**WattRoom is an installable web app, scoped to the whole origin.**

- **One manifest**, `web/static/manifest.webmanifest`: `id`, `start_url` and `scope` all `/`, `display: standalone`. Every same-origin page is inside the app, the prerendered pages too. `/` sends a signed-in rider on to `/enter` as it always has ([0061](0061-the-public-pages-are-prerendered.md)). The server serves it as `application/manifest+json`.
- **Icons from the desktop icon's source.** The manifest's `any` icons are `desktop/build/icon.svg`'s rounded tile, as the favicon is. The home-screen and maskable icons are `icon-full-bleed.svg`: the same tile run to the edges, the bars inside the maskable safe circle, opaque so nothing is filled black.
- **The page owns the screen's edges.** `viewport-fit=cover`, plus `--safe-top/right/bottom/left` tokens (`env(safe-area-inset-*)`) and the `safe-frame`, `safe-p-N` and `safe-px-N` utilities in `app.css`. The shell frame, the phone drawer, the floating buttons, the bottom sheets, the full-screen overlays and the unframed pages pad by them. They are zero on a desk.
- **No service worker.** WattRoom is live state over a socket ([ARCHITECTURE](../ARCHITECTURE.md)): an offline shell would open on a ride it cannot join. Neither iOS nor Chrome needs one to install. A worker would also be a second cache in front of the `no-cache` shell, and that shell is what lets a rider see a new release on the next load and a rollback by image tag ([0019](0019-tagged-releases-and-a-self-converging-vm.md)) take effect.

## Consequences

- A rider who installs from any page gets the whole app, with no browser controls, as long as they stay on wattroom's origin. Leaving it, for an OAuth provider or an external link, shows the platform's own bar until they return.
- An installed iOS web app keeps its own cookies apart from Safari's, so a rider signs in once more inside it. Passkeys and OAuth both work there.
- iOS has no Web Bluetooth, so an installed iPhone app still pairs no trainer. It is the phone surface it already was ([0020](0020-the-app-takes-discords-shape.md)'s amendment), opened like an app.
- A new surface that meets a screen edge (a fixed bar, a bottom sheet, a full-screen overlay) pads by the `--safe-*` tokens. Nothing in a desk browser shows it missing.
- `theme-color` stays the dark surface: the rider's own palette does not yet reach the status bar or the Android title bar.

## Alternatives

- **`apple-mobile-web-app-capable` alone.** iOS's pre-manifest switch. It has the same scope problem, and Chrome ignores it.
- **A service worker for offline and install prompts.** Rejected above: no offline use, and a cache that could pin a rider to an old release.
- **`black-translucent` status bar.** It draws the page under the status bar with white text, which a light theme makes unreadable. The default bar, plus padding by the top inset, works in both schemes.
