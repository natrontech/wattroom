# CLAUDE.md

@AGENTS.md

## Claude-specific

- `.claude/rules/*.md` auto-load into your context — they're already active, follow them.
- Project skills: `go-review` (run on non-trivial hub/protocol/BLE Go changes), `verify` (run before committing nontrivial changes — prove the flow in the running app, not just tests), `design-check` (run on every PR a rider can see: its surfaces against `docs/design/TARGETS.md`, reviewed by a fresh subagent), `issue-run` (take one issue to merged or closed, so the open count falls), `pickup-feedback` (work one rider report into a draft PR), and `audit` (sweep a subsystem against WATTROOM.md, the ADRs and the rules, then turn findings into issues).
- Queue work runs one issue per fresh session: `scripts/issue-runs.sh` (`RUN=/pickup-feedback` for the feedback queue). Never `/loop` it, since a looping session carries every earlier issue's context (#3970).
- Permission allowlist + format-on-edit hooks live in `.claude/settings.json` — edits are auto-formatted, don't hand-run gofmt/prettier.
