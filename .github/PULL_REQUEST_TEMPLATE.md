## What

<!-- One or two sentences. PR title follows conventional commits (feat:/fix:/docs:/chore:) — it becomes the squash commit. -->

## Checklist

- [ ] `make ci` passes locally
- [ ] Changelog entry added as `changelog.d/<category>-<slug>.md` (not an edit to `CHANGELOG.md`) — CI enforces this for `server/` and `web/src` changes; label `no-changelog` if a rider genuinely cannot see it
- [ ] Protocol touched? → edited Go structs + ran `make protocol`, both committed
- [ ] Decision made? → ADR added in `docs/decisions/`
- [ ] BLE layer touched? → tested on real hardware (state trainer model) or explained why simulator coverage suffices
