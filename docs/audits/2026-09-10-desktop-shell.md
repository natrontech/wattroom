# Audit: the desktop shell — 2026-09-10

**Slice.** Everything under `desktop/` (Electron main, preload, packaging, the two workflows) and the web app's desktop-only paths: the bridge helpers, `/download` and the release feed, the sign-in hand-off over `wattroom://`, the notification bridge and its reply field, the HUD window, Bluetooth in Electron, the title-bar strip, the self-update flow, window state, the menu, external links, what the shell exposes to the page.
**Excluded**: the web app's features beyond their desktop branches; the server beyond the redeem endpoint and the release feed.
**Method.** One Explore agent at `06f1ef18`, read-only against WATTROOM.md, ADR-0037, ADR-0040, ADR-0041, ADR-0042, RESEARCH.md §15 and the rules; the high and the security findings verified by reading the cited code before filing. Nothing was built or launched by the agent; the smoke ran locally for the fix.

## Filed

| #     | Finding                                                                           | Severity  | Status                                                                                               |
| ----- | --------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| #1938 | The HUD window closes itself the moment it loads                                  | high      | fixed (#1950): the layout skips `/hud`, the shell ignores the HUD's own message; the smoke drives it |
| #1939 | Permissions are decided by the top frame's URL, not the requesting frame          | security  | fixed (#1950)                                                                                        |
| #1940 | A self-update that never succeeds is never mentioned to anyone                    | bug       | fixed (#1955) |
| #1941 | Any web page can throw a riding shell onto `/login`                               | security  | fixed (#1955): gated on a sign-in started here, handed over IPC |
| #1942 | A crashed renderer leaves a blank window with no way back                         | bug       | fixed (#1950)                                                                                        |
| #1943 | The shell ships Electron's default menu into a frameless window                   | bug       | fixed (#1955) |
| #1944 | A dev run steals the `wattroom://` handler from the installed app                 | bug       | fixed (#1950)                                                                                        |
| #1945 | A notification reply over 500 characters is silently cut                          | bug       | fixed (#1950)                                                                                        |
| #1946 | `ownPath` lets a backslash through the notification href gate                     | security  | fixed (#1950)                                                                                        |
| #1947 | The update watcher is bound to the first window only                              | bug       | fixed (#1950)                                                                                        |
| #1948 | Remember the window's size, position and display                                  | not built | built (#1958) |
| #1949 | Decision: ANT+ — one of the two capabilities the shell was built for — is unbuilt | decision  | `needs-human-input`                                                                                  |

Fixed in #1950 without an issue: `/download` and the home offer sold wake locks the browser already holds (ADR-0037's own refusal) and machine audio on Linux; the restart lives in the sidebar's update row, not on Home; the deb glob never matched the artifact name. Cited rather than re-filed: #1314 (the hardware pass on the signed build), #1303, #1737.

## Checked and found sound

- **Electron hardening** — `contextIsolation`, no `nodeIntegration`, `sandbox`, restated so flipping one is a deliberate deletion; the HUD gets the same three and its own navigation guard; Node unreachable from the renderer is asserted.
- **Navigation and external links** — every `window.open` denied, externals only `https?:`, `will-navigate` keeps the renderer on the app's origin, proven with a stubbed `openExternal`.
- **The preload surface** — twelve named functions, no `ipcRenderer` handle, the key list asserted so a rename cannot silently degrade the app.
- **The deep-link parser** — scheme, host and a bounded token, built with `encodeURIComponent`, four negative cases; **the redeem** single-use, 90 s, constant-time, bounded, same-origin plus strict decode.
- **The Bluetooth chooser** — the scan held open and streamed, the countdown cleared on the first device, a stale pick that cannot settle the next request, the pre-#1716 fallback still working, all covered mechanically.
- **The release pipeline** — tag and `package.json` agreement, the semver gate that rejects the padded month, signing asserted before anything publishes, entitlements matching RESEARCH.md §15.2; `make desktop-release` counts both month spellings.
- **Never mid-ride, structurally** — the update row lives in the sidebar the cave hides; the install is only ever a click. **The power blocker** started and stopped by the wake lock alone, released on every exit.
- **The release feed's failure direction** — a 404, a rate limit or an outage read as "no build yet" and the page teaches.

## Not checked

Everything that needs a built, signed shell or a real OS: the HUD self-close on screen (fixed by reading, then asserted in the smoke against a dead URL); the default menu's stacking against the drag strip on Windows and Linux; TCC prompts and whether the four entitlements suffice; Squirrel.Mac's install-on-restart end to end; NSIS first run and SmartScreen; AppImage and deb first launch; Bluetooth prompts per OS; macOS system audio through the system picker; loopback on Windows; media keys; and the release workflow itself, which has never run — `natrontech/wattroom-releases` and every signing secret still do not exist. docs/HARDWARE-SESSIONS.md has no desktop protocol despite RESEARCH.md §15.5 pointing at it; that belongs with #1314.
