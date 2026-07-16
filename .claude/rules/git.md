# Git & GitHub conventions

## When to commit (Claude decides — don't ask)

Commit automatically when a logical unit of work is complete. One commit = one coherent change that could be reverted independently: a feature slice, a bug fix, a config/tooling change, a refactor of one area, tests for existing code. Never batch unrelated changes; never leave finished work uncommitted at the end of a turn.

## Conventional commits

```
<type>(<scope>): <description>
```

Types: `feat` `fix` `refactor` `docs` `test` `chore` `perf` `style`.
Scopes: `server` `web` `ble` `hub` `protocol` `game` `jukebox` `ci` `deps` — omit when the change is repo-wide (most `docs:`/`chore:`).
Rules: lowercase, imperative mood ("add" not "added"), no trailing period, ≤72 chars. Body only when the "why" isn't obvious.

```
feat(ble): serialize FTMS control-point writes behind 0x80 indications
fix(hub): drop stale metrics when rider leaves mid-tick
feat(game): backyard ramp elimination rules
docs: ADR-0003 …
```

## When to push / branch / PR (Claude decides)

- **Direct to main, push after each logical commit**: docs, specs, ADRs, CI/tooling, small self-contained fixes with green `make ci`. (Valid while main is unprotected — see issue #7; once protection is on, everything below applies.)
- **Branch + PR**: multi-commit features, anything touching the protocol or privacy-relevant paths, risky refactors, or work worth reviewing. Branch `feat/<slug>` or `fix/<slug>`, PR title in conventional-commit form (it becomes the squash commit), body has `Closes #<n>`. Open as draft early if work spans sessions.
- **Never**: force-push shared branches, commit secrets/.env, commit with failing `make ci`, or mix a generated-file regen with unrelated changes (protocol.ts regens ship WITH the Go struct change that caused them).

## GitHub (gh CLI)

Work lives in issues on milestones M0–M6. `gh issue list --milestone …`; read `gh issue view <n> --comments` before starting; comment when picking one up. Labels: `ble` `rooms` `workouts` `game-modes` `infra` `docs` `backlog` (parked — ask first). Out-of-scope discoveries become new issues, not PR scope-creep. Decisions made in threads still get an ADR — GitHub is not the decision record.
