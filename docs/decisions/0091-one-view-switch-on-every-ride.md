# 0091 — One view switch on every ride: 3D, Flat or Map, in one place, and a fallback that says so

- Status: accepted
- Date: 2026-10-26
- Answers: [#4217](https://github.com/natrontech/wattroom/issues/4217)
- Amends: [0066](0066-the-world-is-the-ride-view.md) (how a rider moves between the world and the flat road) and [0071](0071-the-bike-computer-pages-slot-3.md) (MAP is also reached from the switch)

## Context

A rider's 3D world vanished mid-ride, and they found no way back. Moving between the world and the other views felt overwhelming (#4217, Jan's ride of 2026-10-26).

Three controls did this job, each in a different place:
- the world's Flat icon in slot 1's control row, drawn only while the world drew;
- the flat road's "Ride in 3D" or "Try 3D again" button, beside a status line at label size atop slot 1;
- MAP, one of the bike computer's pages, reached with ← → or a page dot.

A world that fell back (dropped frames, a lost GPU context, a window too short) did so silently. The only sign was that label-size line.

## Decision

**One view switch, `3D | Flat | Map`, in slot 1's control row on every riding surface:** a solo ride, a free ride on a road and a session. Decided by Jan, 2026-10-26.

- **The pressed segment is where the rider looks.** Map is pressed while the computer shows its MAP page; otherwise 3D or Flat, by what the horizon draws. 3D or Flat from Map turns the computer back to RIDE.
- **3D says why it is not on.** After a fallback, the 3D segment carries the reason's few words ("⟳ dropped frames"), and a tap tries again. Where a tap cannot help (a browser with no WebGL, a window too short), 3D is disabled with the whole reason as its hint (ux.md).
- **A fallback announces itself** with the fault cue, once (ux.md: a state change announces itself with a sound and a visual; the visual is the 3D segment).
- **The whole reason** (`REASONS`' line) is the switch's status for a screen reader. The separate line and its button retire.
- The switch is drawn only on a ride with a road, as the world and MAP are.
- It replaces the Flat icon, the flat road's buttons and the "Ride in 3D" naming. The World control in Settings → Appearance stays the stored choice, and each tap on 3D or Flat writes it, as before.

## Consequences

- TARGETS ride-road-world 7, ride-free-road 7, ride-skyline-fallback 2 and 3, and MAP's item 30 are amended to the switch.
- `REASONS` carries a short form and a `retry` flag for each reason, in place of a button label.
- The computer's pages are asked for by an event (`askPage`), shared by the M key and the switch. The computer publishes the page it shows.
- A phone in a session draws no world yet. Its switch comes with the band, in #4218.

## Alternatives

- **A louder fallback only:** a big "Try 3D again" where the world was. It leaves three controls in three places, which is the overwhelm the rider named.
- **3D and Flat as one toggle, MAP left to the pages:** MAP is where a rider looks instead of the world, so it belongs in the same switch.
