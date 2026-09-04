# CLAUDE.md

@AGENTS.md

## Claude-specific

- `.claude/rules/*.md` auto-load into your context — they're already active, follow them.
- Project skills: `go-review` (run on non-trivial hub/protocol/BLE Go changes), `verify` (run before committing nontrivial changes — prove the flow in the running app, not just tests), `pickup-feedback` (work one rider report into a draft PR; driven by `/loop`), and `audit` (sweep a subsystem against WATTROOM.md, the ADRs and the rules, then turn findings into issues).
- Permission allowlist + format-on-edit hooks live in `.claude/settings.json` — edits are auto-formatted, don't hand-run gofmt/prettier.
