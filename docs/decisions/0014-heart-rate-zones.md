# 0014 — Heart-rate zones anchor on LTHR, derived like power zones from FTP

- Status: accepted
- Date: 2026-08-31

## Context

Workout steps can carry HR bands (#67 flavour 1) and the rider's own bpm renders
in every cockpit, but the app has no notion of *whose* heart rate is high or low
— 150 bpm is Z2 for one rider and threshold for another. Riders asked for HR
zones that are configurable in the profile and derived automatically, the way
power zones fall out of one FTP number. ADR-0008 constrains the design: HR is
the rider's own signal, display-only, never scored, never cross-rider.

## Decision

One anchor number, **LTHR** (lactate threshold heart rate, bpm), lives in the
rider's profile next to FTP — device-local like the sprint setup, editable by
hand. Five zones derive from it using the standard Coggan HR levels (% LTHR);
the table is specced in docs/SPEC.md and rendered read-only wherever zones show.
No per-zone editing (95 % rule: riders who know enough to want custom zone edges
also know they map to the same anchor).

A completed, scoreable **ramp test suggests LTHR** as 90 % of the test's highest
recorded heart rate (a maximal ramp ends near HRmax; 0.90 × HRmax is the
standard field estimate — default, tune in alpha). Suggested, one tap to apply,
never auto-applied — the same posture as FTP suggestions.

HR zones colour **only the rider's own bpm**. Other riders' tiles keep raw bpm:
zoning someone else's heart rate would need their LTHR, which never leaves their
device, and reading a teammate's effort state is exactly the cross-rider HR
inference ADR-0008 rules out.

## Consequences

- The bpm readout can finally say something ("Z2" vs "threshold") without any
  new data crossing the wire — LTHR stays in localStorage, zones are a pure
  function of it.
- HR bands in workouts stay raw bpm (SPEC); %LTHR-relative workout targets
  remain the documented upgrade path and would build on this anchor.
- Zones stay display-only: no HR execution, medals or ranking (ADR-0008).
- A rider without a strap or LTHR sees exactly today's UI — the feature is
  invisible until the anchor exists.
- Revisit trigger: server-side LTHR (for cross-device sync) is fine to add
  later — it is the rider's own profile number, same class as FTP — but the
  cross-rider visibility boundary above is ADR-0008's and does not move.
