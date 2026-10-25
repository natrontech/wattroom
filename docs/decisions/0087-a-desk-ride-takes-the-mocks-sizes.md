# 0087 — A desk ride takes the mocks' sizes, and the chrome keeps the desk's

- Status: accepted
- Date: 2026-10-18

## Context

SPEC's desk column ("The bike computer") held a riding surface to watts at 104 px, time left at 72 px, secondary numbers at 36 px, and words and labels at 24 px, from arcmin floors at 0.8 m. D1 noted that the mocks' 11–21 px labels sat under that floor and let panels grow instead. Over October the 24 px floor also spread to the chrome around the ride: the sidebar (#3770), the people column (#3828, #3758) and the menu a crew tile opens (#3943). Starting a ride zoomed the whole app. Jan, riding on 2026-10-18: "that zoom thing is also annoying when you ride", then, of the panels: "all the other things are too scaled up and looking ugly", "we want to have more space so things can be tinier". Asked twice, he picked all of the chrome, then the mocks' sizes for the panels. The same day #4080 found the zoom reaching spectators who had not joined the session.

## Decision

On a desk the ride takes the proportions of the v2 mocks: watts 76 px, time left 52 px, secondary numbers 24 px, words 14 px, labels 11 px, and spacing at three quarters of the desk's. The theme's text and spacing scale is redefined under the riding surface (`[data-surface=docked]`, `[data-surface=flat]`, `[data-ride-stage]` in `app.css`), so every utility inside follows. TV mode, the HUD and the phone keep their own distance sizes.

The sidebar, the people column (jukebox, soundboard, the rider list) and the context menu are chrome. On a ride they keep their desk sizes. They still take the cave's dark scheme (G1) and still hide the desk's teaching sentences (`cave:hidden`). A mid-ride menu is still placed clear of the corridor and of the panel it opened from. A rider who has not joined a live session watches it at the desk (#4080).

## Consequences

- A desk ride no longer meets SPEC's arcmin floors at 0.8 m. A rider who rides from further back uses TV mode, which keeps them.
- The ride's controls are 33 px on a desk, under WCAG 2.5.5's 44 px; a mouse presses them there. The phone keeps 44 px.
- `nav/cave-sizes.ts` and `channel/rail-size.ts` are gone, along with the size-only `cave:` utilities. `cave:hidden` stays.
- The design probe exempts the sidebar, the people column and menus from the ride's word floor.
- Amends the sizing parts of #3770, #3828, #3758 and #3943. G1's spectator line from #3029 now covers riders on the session, a rider a game put out among them.

## Amendment, 2026-10-25 (#4160)

The chrome no longer takes a dark scheme on a ride: the ride keeps the rider's scheme ([ADR-0005](0005-synthwave-visual-identity.md), amended the same day). `cave:hidden` is `ride:hidden`, keyed on the frame's `data-ride`.
