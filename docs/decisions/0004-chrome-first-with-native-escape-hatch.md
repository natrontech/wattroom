# 0004 — Chrome-first stands; native wrapper is a contained escape hatch, not a rewrite

- Status: accepted
- Date: 2026-08-25

## Context

Web Bluetooth confines WattRoom to Chromium browsers (~76% global, Safari/Firefox: never). The concurrency research (RESEARCH.md §12) also catalogued browser-imposed friction: AEC can't be guaranteed, hidden-tab timer throttling, YouTube RMF layout rules. Fair question: should this be a native app (Tauri/Electron) instead?

Verified escape-hatch landscape (2026):
- **Electron**: bundles Chromium — Web Bluetooth works with a `select-bluetooth-device` handler; the entire WattRoom web app would run **unchanged**. Cost: ~100MB+ runtime, update/signing pipeline.
- **Tauri v2**: light, but its webview is the OS engine — **WKWebView on macOS has no Web Bluetooth**. BLE instead goes through the maintained [tauri-plugin-blec](https://github.com/MnlPhlp/tauri-plugin-blec) (btleplug; Win/Linux/Mac/Android tested, on the official plugin registry) — i.e. a different transport implementing our existing `Trainer` interface. WebRTC/LiveKit works in WKWebView.

## Decision

**Browser-first on Chrome/Edge remains the platform** for MVP and alpha. "Install Chrome" is an acceptable ask for a training crew; "click this link to spectate/join" is a core product loop that only the web delivers, and a native app would add signing, notarization, updates, and a second distribution channel before the product hypothesis is even validated.

The hedge is architectural, not aspirational: **all Chrome-dependent code stays behind the `Trainer` interface** (already a hard rule). Nothing else in the stack assumes Chrome.

## Consequences

- If a native shell is ever needed, the menu is concrete: **Electron = zero code change** (fastest), **Tauri = swap the BLE transport** behind `Trainer` (+ lighter, and coincidentally the only credible iOS path should ADR-scoped "web-only forever" ever be revisited — its webview + native BLE plugin sidestep Safari's Web Bluetooth refusal).
- Revisit triggers: (1) alpha riders demonstrably refuse to use Chrome; (2) a browser regression breaks Web Bluetooth or WebRTC for the use case; (3) the app needs OS capabilities the web can't grant (ANT+, system-audio capture).
- Until a trigger fires: no wrapper work, no dual distribution. The web app is the product.
