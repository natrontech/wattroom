# Code quality & consolidation

## Before writing new code

1. **Search first** — grep for an existing implementation before writing one.
2. Every concept has one canonical home: WS wire types → `server/internal/protocol/` (never redeclare, TS side is generated); live room state → `server/internal/hub/`; trainer/BLE → behind the `Trainer` interface in `web/src/lib/ble/` (planned); frontend fetch through one shared client module once it exists — no scattered `fetch` boilerplate.
3. A pattern appearing in 2+ places gets extracted in the same change.

## Self-documenting code

Names describe behavior (`coalesceTick`, `armSprint`); one concept per file; files named for their contents. Comments only for what code can't say (invariants, protocol quirks, `ponytail:` ceilings) — never narration.

## When modifying existing code

Read the whole file first; grep for callers before changing a signature and update every call site; update the tests of every function you touched. Changed a protocol struct → `make protocol`, commit both sides.

## Size discipline

Soft ceilings — split in the same change when crossed: Go files ~400 lines, Svelte components ~500, TS modules ~300.

## Done-checklist for any change

- [ ] No new duplication (function, type, magic number)
- [ ] Colors/durations from theme tokens, product numbers from docs/SPEC.md
- [ ] No dead or commented-out code
- [ ] `make ci` green
