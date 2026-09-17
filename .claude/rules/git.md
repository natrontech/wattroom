# Git & GitHub conventions

## When to commit (Claude decides — don't ask)

Commit with explicit pathspecs, never `git add -A`: the tree may hold a neighbour's uncommitted work, and a wildcard add makes it yours.

Commit automatically when a logical unit of work is complete. One commit = one coherent change that could be reverted independently: a feature slice, a bug fix, a config/tooling change, a refactor of one area, tests for existing code. Never batch unrelated changes; never leave finished work uncommitted at the end of a turn.

## Conventional commits

```
<type>(<scope>): <description>
```

Types: `feat` `fix` `refactor` `docs` `test` `chore` `perf` `style`.
Scopes: `server` `web` `desktop` `ble` `hub` `protocol` `game` `jukebox` `ci` `deps` — omit when the change is repo-wide (most `docs:`/`chore:`).
Rules: lowercase, imperative mood ("add" not "added"), no trailing period, ≤72 chars. Body only when the "why" isn't obvious.

```
feat(ble): serialize FTMS control-point writes behind 0x80 indications
fix(hub): drop stale metrics when rider leaves mid-tick
feat(game): backyard ramp elimination rules
docs: ADR-0003 …
```

## When to push / branch / PR (multi-contributor phase — humans + Claude + Codex in parallel)

- **A worktree, a branch and a draft PR are the default for all work** — created before the first edit, not before the first commit (AGENTS.md, "Working on the issue board", has the sequence and the reason a bare branch is not isolation). `git worktree add ../wattroom-worktrees/<slug> -b feat/<slug>`, open a **draft PR early** with `Closes #<n>` — in-flight drafts are how everyone sees what's being worked on. PR title in conventional-commit form (it becomes the squash commit).
- **No direct pushes to main**, not even trivial doc fixes or ADR text — a repository ruleset rejects them (`GH013: Changes must be made through a pull request`). This superseded the old convention-only rule from #7; the branch + PR path below is the only one that works. `make release` goes through a PR for the same reason.
- **Every PR adds its changelog entry as its own file**: `changelog.d/<category>-<slug>.md`, category being added / changed / deprecated / removed / fixed / security. Never edit `CHANGELOG.md` directly — eight agents appending to the same section conflicted constantly, and a conflict resolved carelessly during a rebase drops somebody's entry. `make release` collates the files and deletes them. CI fails a PR touching `server/` or `web/src` without one; the `no-changelog` label is the escape for work a rider cannot see. Write it for someone deciding whether to upgrade, not as a second copy of the PR title.
- **A closing keyword in a PR body is parsed, not read.** GitHub scans for `closes`/`fixes`/`resolves` beside an issue number and acts on it; it does not read the question mark after it, the bold **No** following it, or the sentence explaining that the issue stays open. #2331's body said `Closes #2330? **No** — it stays open until someone with a Garmin account runs it`, and the merge closed #2330 as *completed* — the sentence written to prevent a premature close is what caused one. An obligation nobody can discharge then reads as discharged, which is the worst shape a stale board can take. So: use `Refs #<n>` for anything the PR does not finish, and if the relationship needs explaining, put the words in an order the parser cannot match — "does not close #2330". Check `gh issue view <n> --json state` after merging a PR that names an issue it did not finish.

- **Never**: force-push shared branches, commit secrets/.env, commit with failing `make ci`, mix a generated-file regen with unrelated changes (protocol.ts regens ship WITH the Go struct change that caused them), or cut a release by hand — `make release` is the only path (it computes the CalVer number itself), and it refuses when `## [Unreleased]` is empty.

## GitHub (gh CLI) — claim before you code

Work lives in issues on milestones (M0 onward); nobody (human or agent) works untracked.

1. `gh issue view <n> --comments`, `gh pr list`, `git worktree list` — if it's assigned, claimed, has an open PR, or matches a branch name someone has a worktree on, coordinate there instead of duplicating. The draft PR is the claim and often exists with the issue thread still empty (#280 → #284 and #294); a worktree branch with no commits yet has no ref and no PR for either command to find, which is how one test got written three times (#297, #302, #304, #305).
2. **Cut the branch before you claim** — `git checkout -b feat/<slug> origin/main`, or the `git worktree add` that does both. The worktree branch is the signal step 1 looks for and the only one that shows instantly; claiming by comment first means emitting it last, and that gap is where the collisions happen (#1003, #267). Re-run step 1 after reading the code, before the first edit.
3. Claim: `gh issue edit <n> --add-assignee @me` + a one-line approach comment. Standing down instead? Say "proceed, do not stand down on account of my comment" — two agents each deferring to the other leaves the issue undone.
4. Progress, blockers, and findings go in the issue/PR thread — not chat apps. Decisions in threads still get an ADR.
5. Out-of-scope discoveries → new issue (right milestone + label), never PR scope-creep.
6. **Reading a PR's checks: `gh pr checks <n>`, never `statusCheckRollup`.** The rollup returns *every* run of a check, not the current one, and a superseded run keeps its old conclusion forever. That is routine here rather than an edge case: `changelog.yml` triggers on `labeled` and cancels in-progress runs, so applying `no-changelog` leaves a dead `FAILURE` — or a `CANCELLED`, when the label beats the first run to the finish — sitting in the array beside the `SKIPPED` that replaced it. #1061, #1073 and #1115 all read red that way and all three are green; the first two were briefly mistaken for the changelog gate being bypassed in practice (#1043). `gh pr checks` collapses to the newest run and is correct. When you genuinely need JSON, take the newest run per name:

   ```bash
   gh pr view <n> --json statusCheckRollup --jq '
     [.statusCheckRollup[]]
     | group_by(.name // .context)
     | map(max_by(.startedAt // .createdAt))
     | map(select((.conclusion // .state) as $c
           | $c != "SUCCESS" and $c != "SKIPPED" and $c != "NEUTRAL"))
     | if length == 0 then "all green"
       else map("\(.name // .context): \(.conclusion // .state)") | join(", ") end'
   ```

   Ask what a conclusion is **not**, as above, rather than listing the ways one can fail: `FAILURE` was the whole list until `CANCELLED` turned up, and the next one will not announce itself either.

7. **Which checks gate a merge, and which only inform.** `main`'s ruleset (`bypass_actors: []`) requires exactly five contexts:

   ```
   server  web  vulncheck  docs  changelog
   ```

   Everything else that runs — `e2e`, the desktop smoke, `web-node-next` — is **advisory**: a red one is a real finding and a reviewer's job, but it blocks nothing. Don't describe an advisory check as a gate, and don't assume a green headline means the ride passed.

   `changelog` is requirable because it **always reports**: the workflow carries no paths filter, so on a PR it exempts (a `no-changelog` label, a `release/` branch) it still reports `skipping`, and a ruleset counts that as reported (#1044, #1045).

   `e2e` cannot be, as it stands, and this is the whole reason it is advisory rather than an oversight: `e2e.yml` filters on `paths: ['web/**', 'server/**', '.github/workflows/e2e.yml']`, so on a docs-only or ADR-only PR it never starts and therefore never reports. A required context that never reports leaves the PR pending forever — every docs PR unmergeable, and `make release` jammed, because a release PR touches only `CHANGELOG.md` and `changelog.d/`. Requiring it means first adding a skip-shim job outside the paths filter that reports the context, or paying the full ride on every docs PR. Neither is a ruleset toggle.

   `web-node-next` is advisory by decision, not by accident (#2074): it graduates into the already-required `web` job when Node 26 becomes Active LTS, so a non-LTS Node can never stop the repo in the meantime.

Labels — **area**: `ble` `rooms` `workouts` `game-modes` `jukebox` `infra` `docs` `design`. **Kind**: `bug` `enhancement` `security` `feedback` (a rider report from the in-app flag button — ADR-0006; the `pickup-feedback` skill works this queue). **State**: `blocked` (waiting on another issue — the body names which), `backlog` (parked — ask first), `needs-human-input` (a decision a contributor must make — **do not implement what the issue says**; it usually records one person's opening position and wants push-back). The bar is that the repository cannot answer it: canon answering it makes it a defect, a stale doc gets amended, and two plausible options is not the bar (AGENTS.md has the test). Ask while the maintainer is there; the issue is the fallback. **Process**: `no-changelog` (PR is invisible to riders — exempt from the CHANGELOG check), `good-first-issue`.
