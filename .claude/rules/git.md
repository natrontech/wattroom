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

## When to push / branch / PR (multi-contributor phase — humans + Claude + Codex in parallel)

- **Branch + PR is the default for all feature work.** Branch `feat/<slug>` or `fix/<slug>`, open a **draft PR early** with `Closes #<n>` — in-flight drafts are how everyone sees what's being worked on. PR title in conventional-commit form (it becomes the squash commit).
- **Direct to main** only for trivial doc fixes and ADR text. `main` has no platform protection (private repo, free plan — #7 closed as not-planned): the PR rule is convention-enforced, so double-check `make ci` locally before any direct push; nothing else will catch it.
- **Never**: force-push shared branches, commit secrets/.env, commit with failing `make ci`, or mix a generated-file regen with unrelated changes (protocol.ts regens ship WITH the Go struct change that caused them).

## GitHub (gh CLI) — claim before you code

Work lives in issues on milestones M0–M6; nobody (human or agent) works untracked.

1. `gh issue view <n> --comments`, `gh pr list`, `git worktree list` — if it's assigned, claimed, has an open PR, or matches a branch name someone has a worktree on, coordinate there instead of duplicating. The draft PR is the claim and often exists with the issue thread still empty (#280 → #284 and #294); a worktree branch with no commits yet has no ref and no PR for either command to find, which is how one test got written three times (#297, #302, #304, #305).
2. Claim: `gh issue edit <n> --add-assignee @me` + a one-line approach comment.
3. Progress, blockers, and findings go in the issue/PR thread — not chat apps. Decisions in threads still get an ADR.
4. Out-of-scope discoveries → new issue (right milestone + label), never PR scope-creep.

Labels: `ble` `rooms` `workouts` `game-modes` `infra` `docs` `backlog` (parked — ask first).
