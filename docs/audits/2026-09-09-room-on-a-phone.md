# Audit: the room on a phone (2026-09-09)

**Slice.** The spectator's whole path at 375×812: `device.svelte.ts`'s gate (`narrow`, `coarse`, `bluetooth`, `?full=1`), the root layout's drawer, `RoomShell`, `TrainingPhone`, `PeopleSheet`, `CrewStrip`, the Lounge, Chat and the side panel on narrow, following a rider, voice on a phone, the stage and player rules, the game and sprint surfaces on the phone, toasts and `FaultBanner` at 375, and `phone-width.spec.ts` / `mobile-room.spec.ts`.

**Excluded.** The desktop shell, jukebox internals, DMs, the workout editor, everything outside a room (audited earlier the same day). Open decisions reported, not re-decided.

**Method.** One read-only Explore agent at `42c52583`+ against WATTROOM.md's spectator amendment (ADR-0020, 2026-09-05), ux.md's phone rules, errors.md, ADR-0005 and the day's keyboard/a11y rules; the highs and mediums verified by reading the cited code before filing.

## Findings and where they went

| # | Finding | Kind | Disposition |
|---|---|---|---|
| 1 | Blocked audio and a refused mic were reported only inside the closed drawer | bug, high | #1622 → **#1629** |
| 2 | The Lounge scrolled sideways at 375 whenever anything was on stage (`px-8` + a 320 px stage floor) | bug, high | #1623 → **#1629** |
| 3 | The room's phone spec ran at 393 and never produced a spectator | not-built, high | #1624 → **#1629** |
| 4 | `?full=1` was lost on the first navigation | bug | #1625 → **#1629** |
| 5 | Escape peeled two layers (the drawer and the followed rider) | bug | #1625 → **#1629** |
| 6 | A toast lands on top of the YouTube player on a phone | bug | #1626 (open — needs a reserved space or a z-order the seated dock wins) |
| 7 | The followed rider was unnamed during a sprint and a game | bug | #1627 → **#1629** |
| 8 | The Lounge's last row sat under the floating buttons | polish | #1627 → **#1629** |
| 9 | A spectator was offered "Join the ride" | drift | #1627 → **#1629** |
| 10 | A phone could not stop following (the followed rider was never in the strip) | bug | #1627 → **#1629** |
| 11 | The sheet kept its desktop resize grip on touch | polish | #1628 → **#1629** |
| 12 | Message actions are invisible but tappable on touch | bug, low | #1628 (open) |
| 13 | Long-press cancels on the first pointermove | polish | #1628 (open) |
| 14 | `FaultBanner` squeezed its copy to ~140 px at 375 | polish | #1628 → **#1629** |

## Checked and found sound

- The crew strip is the phone's primary action and is right: whole-tile 176 px targets in their own `overflow-x-auto`, thumb-reachable; `followedRider` reuses the Lounge's focus rather than a second concept, and `focusId` survives place navigation.
- Capability gating hides rather than fails: `SessionControls`, `SensorOverview`, the sessions page's `manages`, `placesFor` dropping Settings; the Training empty state teaches instead of listing absent buttons.
- The drawer's `inert`, focus return and close-on-navigation hold; the people sheet is a real dialog with a focus trap; the shell is `h-dvh`.
- The RMF rule holds where it matters: the stage seat is never overlaid, the sheet un-seats the dock, and `TrainingPhone` puts numbers under the picture.
- Long-press menus exist on rooms in the drawer, riders and messages. No pixel-width-on-a-measured-SVG in the room. Voice failure itself reaches the phone as a persistent `FaultBanner`; `startPlayback` is armed off the first pointerdown. Mid-ride targets are 44 px where they should be.

## Not covered anywhere

No spec opens the people sheet, the jukebox dock, a stage, a sprint, a game or the composer at phone width, and nothing handles the software keyboard (no `visualViewport` or `interactive-widget`). Worth a phone walk of the mid-ride surfaces once a fixture can start a session.
