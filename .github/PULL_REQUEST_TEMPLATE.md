## What

<!-- One or two sentences. PR title follows conventional commits (feat:/fix:/docs:/chore:) — it becomes the squash commit. -->

## Checklist

- [ ] `make ci` passes locally
- [ ] A rider can see it? → a `## Design check` section per `docs/design/DESIGN-CHECK.md`, with a PASS verdict before this leaves draft
- [ ] Changelog entry added as `changelog.d/<category>-<slug>.md` (not an edit to `CHANGELOG.md`) — CI enforces this for `server/` and `web/src` changes; label `no-changelog` if a rider genuinely cannot see it
- [ ] Protocol touched? → edited Go structs + ran `make protocol`, both committed
- [ ] Decision made? → ADR added in `docs/decisions/`
- [ ] BLE layer touched? → tested on real hardware (state trainer model) or explained why simulator coverage suffices
- [ ] Named something a rider reads (an item, a place, a mode)? → not a common word that is also a cycling mark: Record, Edge, Look, Time, Bell, Giant, Scott, Trek. The catalogue test refuses the rest (#3256)
