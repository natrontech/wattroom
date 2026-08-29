# 0007 — Alpha hardware is all FTMS; WCPS leaves M1

- Status: accepted
- Date: 2026-08-29

## Context

[WATTROOM.md](../../WATTROOM.md) line 105 makes WCPS M1 scope on an explicit premise:
"Alpha hardware = one Core + several v2s, so WCPS is M1 scope, not a fallback." That
premise is wrong, and it is wrong because of a product-naming collision.

**KICKR v2 (2016)** is Wahoo's old flagship. It predates FTMS, never received it, and is
controlled through the proprietary WCPS characteristic — this is the machine
[RESEARCH.md §9](../RESEARCH.md) was written about, and the reason `WcpsTrainer` was
planned as a second driver.

**KICKR CORE v2** is a current Core. Different machine, similar name. It is what the
team's colleagues actually ride.

The GATT dump on [#43](https://github.com/natrontech/wattroom/issues/43) (2026-08-29,
firmware 3.0.23, two identical dumps four minutes apart) settles what that hardware
speaks:

- FTMS `0x1826` present, with Control Point `0x2AD9` (write+indicate) and Indoor Bike
  Data `0x2AD2`
- Feature targets `0x0000600c` — **Power Target (ERG)** and **Indoor Bike Simulation**,
  the two modes the product needs
- Cadence supported, asserted independently by the FTMS cadence bit and the CPS
  crank-revolution bit

So the alpha fleet is one Kickr Core plus several Kickr Core v2 — **all FTMS**. Nobody on
the team owns a pre-FTMS Wahoo trainer.

## Decision

**WCPS is a fallback, not M1 scope.** `FtmsTrainer` covers every trainer anyone on this
team will ride during alpha. `WcpsTrainer` moves to the backlog and gets built when a
rider actually turns up with a pre-FTMS Wahoo — at which point the protocol map is
already written and the `Trainer` interface is already the seam it plugs into.

This supersedes the WCPS half of WATTROOM.md line 105 and the v2 line in its M1 list.
The `Trainer` interface itself is untouched and stays exactly as specified: two drivers
were always meant to prove the abstraction, and `SimulatedTrainer` already does that job
in dev and CI.

[RESEARCH.md §9](../RESEARCH.md)'s WCPS protocol map **stays in the doc**. It is correct
research, it cost real effort to assemble from three reference implementations, and it is
precisely what the person who eventually needs it will want. Only its scheduling changes.

## Consequences

- M1 loses a whole proprietary BLE driver. That is the largest single scope reduction in
  the milestone, and it is free — it removes work nobody's hardware needed.
- The "v2 has no reliable cadence, so pair a CSC sensor" line in WATTROOM.md loses its
  alpha urgency. **The cadence-absent fallback in the spiral guard stays regardless** —
  it is already built and tested, and it protects any rider whose trainer reports no
  cadence, which is a broader case than one trainer model.
- #43 is answered rather than deferred: the enumeration it asked for exists, on the
  hardware that matters.
- Risk accepted: if an alpha rider does turn up with a 2016 v2, they cannot ride until
  `WcpsTrainer` is built. Acceptable — we now know the fleet, and the driver is a known
  quantity rather than research.
- Revisit trigger: a rider brings a pre-FTMS Wahoo, or a second trainer brand turns out
  to need a non-FTMS path. Either pulls `WcpsTrainer` back off the backlog.
- Naming discipline: "v2" alone is ambiguous in this codebase and caused this. Write
  **KICKR v2 (2016)** or **KICKR CORE v2** in full, always.
