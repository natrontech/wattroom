# 0087 — The chrome keeps its desk size on a ride

- Status: accepted
- Date: 2026-10-18

## Context

TARGETS G4 and G5 hold a riding surface to 24 px words and 44 px targets. Over October that floor spread from the ride's panels to the chrome around them: the sidebar (#3770), the people column (#3828, #3758) and the menu a crew tile opens (#3943). Starting a ride then zoomed the whole app. Jan, riding on 2026-10-18: "that zoom thing is also annoying when you ride". Asked which parts should stop zooming, he picked all of the chrome. The same day #4080 found the zoom reaching spectators who had not joined the session.

## Decision

The sidebar, the people column (jukebox, soundboard, the rider list) and the context menu are chrome. On a ride they keep the sizes they have at the desk. They still take the cave's dark scheme (G1) and still hide the desk's teaching sentences (`cave:hidden`). The ride's own panels keep G4's sizes and G5's 44 px targets. A mid-ride menu is still placed clear of the corridor and of the panel it opened from. A rider who has not joined a live session watches it at the desk (#4080).

## Consequences

- `nav/cave-sizes.ts` and `channel/rail-size.ts` are gone, along with the size-only `cave:` utilities. `cave:hidden` stays.
- The chrome's buttons go back to the desk's 28–38 px. The jukebox and the soundboard are a smaller target for a pedalling thumb. Revisit if riders miss them mid-ride.
- The design probe exempts the sidebar, the people column and menus from G4's word floor.
- Amends the sizing parts of #3770, #3828, #3758 and #3943. G1's spectator line from #3029 now covers riders on the session, a rider a game put out among them.
