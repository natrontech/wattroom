# CLAUDE.md

@AGENTS.md

## Claude-specific

- `.claude/rules/*.md` auto-load into your context — they're already active, follow them.
- Project skills: `go-review` (run on non-trivial hub/protocol/BLE Go changes), `verify` (run before committing nontrivial changes — prove the flow in the running app, not just tests), and `pickup-feedback` (work one rider report into a draft PR; driven by `/loop`).
- Permission allowlist + format-on-edit hooks live in `.claude/settings.json` — edits are auto-formatted, don't hand-run gofmt/prettier.
