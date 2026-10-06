# Code quality

## Before writing

- Grep for an existing implementation first.
- One home per concept: WS wire types in `server/internal/protocol/` (the TS side is generated), live channel and session state in `server/internal/hub/`, trainer and BLE behind the `Trainer` interface in `web/src/lib/ble/trainer.ts`, frontend fetches through `$lib/api.ts`.
- A pattern in two places is extracted in the same change.

## Writing

- Names say what the code does (`coalesceTick`, `armSprint`). One concept per file, named for its contents.
- Comments only for what code can't say: invariants, protocol quirks, `ponytail:` ceilings. Never narration.
- Split in the same change when a file passes ~400 lines (Go), ~500 (Svelte) or ~300 (TS). Pure data tables (`workout/library.ts`, `sound/cue-catalogue.ts`, `themes.ts`) are exempt; logic beside them is not.

## Changing code

- Read the whole file first. Grep every caller before changing a signature and update each one, including callers the issue doesn't name.
- Update the tests of every function you touched. A test that fails because code moved is working: make it follow, never loosen it.
- A changed protocol struct means `make protocol`, both sides committed.

## Done

- [ ] No new duplication (function, type, magic number).
- [ ] A test for a silent failure was seen red: break the code the realistic way, watch it fail, restore.
- [ ] Colors and durations from theme tokens; product numbers from docs/SPEC.md.
- [ ] Anything that animates without end has a `/dev/perf` case and a `make perf` measurement (docs/PERFORMANCE.md).
- [ ] No dead or commented-out code.
- [ ] `make ci` green.
