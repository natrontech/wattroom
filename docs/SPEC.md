# Product Spec — the numbers and flows behind WATTROOM.md

[WATTROOM.md](../WATTROOM.md) says _what_ and _why_; the spec pins the concrete values and flows so implementations match intent. Values marked **(default — tune in alpha)** are starting points, changeable without an ADR; everything else changes only via ADR.

The spec lives in `docs/spec/`, one file per area: load only the area you work on. A citation such as `docs/SPEC.md, "Motion"` names a section below. A cited name that is not a section is a bold label inside one: `grep -rn 'Felt grade' docs/spec/`.

| Section | File |
|---|---|
| Glossary | [glossary.md](spec/glossary.md) |
| Roles & permissions; The crew, its owner and its channels | [roles.md](spec/roles.md) |
| Workout JSON | [workouts.md](spec/workouts.md) |
| Power zones | [stats.md](spec/stats.md) |
| Heart-rate zones | [stats.md](spec/stats.md) |
| The rider's two numbers | [stats.md](spec/stats.md) |
| Stats formulas | [stats.md](spec/stats.md) |
| XP sources; Achievements | [stats.md](spec/stats.md) |
| Training load | [stats.md](spec/stats.md) |
| How a ride felt | [stats.md](spec/stats.md) |
| Ride guards | [riding.md](spec/riding.md) |
| Virtual gears | [riding.md](spec/riding.md) |
| Medals (per group session) | [stats.md](spec/stats.md) |
| Planned sessions | [crew.md](spec/crew.md) |
| Open rides | [races.md](spec/races.md) |
| Text channel chat | [crew.md](spec/crew.md) |
| Personal status | [crew.md](spec/crew.md) |
| Session recap retention | [crew.md](spec/crew.md) |
| Game mode parameters | [game-modes.md](spec/game-modes.md) |
| The roadside | [races.md](spec/races.md) |
| Route rides | [roads.md](spec/roads.md) |
| A route's place | [roads.md](spec/roads.md) |
| Road segments and ghosts | [roads.md](spec/roads.md) |
| Road times | [roads.md](spec/roads.md) |
| Road stats and collections | [roads.md](spec/roads.md) |
| Races | [races.md](spec/races.md) |
| Drafting | [races.md](spec/races.md) |
| Riding a road together | [races.md](spec/races.md) |
| Crew Tour | [races.md](spec/races.md) |
| The world | [world.md](spec/world.md) |
| Real ground | [world.md](spec/world.md) |
| The figure | [garage.md](spec/garage.md) |
| Wardrobe | [garage.md](spec/garage.md) |
| The living world | [world.md](spec/world.md) |
| Rider animation | [motion.md](spec/motion.md) |
| Motion | [motion.md](spec/motion.md) |
| The bike computer | [riding.md](spec/riding.md) |
| Sync tolerances | [riding.md](spec/riding.md) |
| Voice channel audio defaults (once “Room audio defaults”) | [voice.md](spec/voice.md) |
| Notifications | [crew.md](spec/crew.md) |

A new section goes into its area's file and gets a row here.
