# Git and GitHub

Claiming, worktrees and merging are in AGENTS.md ("Taking work", "Merging and cleaning up").

## Commits

- Commit each finished logical unit without asking: one change that could be reverted on its own (a slice, a fix, a tooling change, one refactor, tests). Never batch unrelated changes; never end a turn with finished work uncommitted.
- Stage explicit pathspecs. Never `git add -A`: the tree may hold a neighbour's work.
- `<type>(<scope>): <description>`. Types: `feat` `fix` `refactor` `docs` `test` `chore` `perf` `style`. Scopes: `server` `web` `desktop` `ble` `hub` `protocol` `game` `jukebox` `ci` `deps`, omitted for repo-wide changes. Lowercase, imperative, no trailing period, ≤ 72 characters; a body only when the why isn't obvious. E.g. `fix(hub): drop stale metrics when rider leaves mid-tick`.
- A generated file ships with the change that caused it (`protocol.ts` with its Go struct), never with unrelated work.
- Never commit secrets or `.env`, never commit with `make ci` failing, never force-push a shared branch, never push to `main`.

## Pull requests

- **Changelog**: each PR adds `changelog.d/<category>-<slug>.md` (added, changed, deprecated, removed, fixed, security) holding one bullet for someone deciding whether to upgrade. Never edit `CHANGELOG.md`; `make release` collates the files. CI fails a PR touching `server/` or `web/src` without one; label `no-changelog` when no rider sees the change.
- **Closing keywords**: GitHub closes an issue when `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves` or `resolved` stands next to its number in a PR body or commit message, negated, quoted or fenced alike. Write `Closes #<n>` only for the issue the PR finishes, `Refs #<n>` for every other, and a placeholder (`#<n>`) when writing about the mechanism. Before pushing:

  ```bash
  grep -inE '(close[sd]?|fix(es|ed)?|resolve[sd]?)[[:space:]:]+#[0-9]+' <file>
  ```

  After merging a PR that names an issue it did not finish, check `gh issue view <n> --json state`.

- **Squash subject**: a one-commit branch squashes under that commit's subject, not the PR title. Pass it: `gh pr merge <n> --squash --subject '<title> (#<n>)'`.
- Never tag or release by hand: `make release` computes the CalVer number and refuses an empty `## [Unreleased]`.

## Checks

- Read checks with `gh pr checks <n>`, never `statusCheckRollup`: the rollup keeps every superseded run, so labelling `no-changelog` leaves a dead `FAILURE` or `CANCELLED` beside the `SKIPPED`. When you need JSON, take the newest run per name and ask what a conclusion is not:

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

- Required on `main`: `server` `web` `vulncheck` `docs` `changelog`. Everything else (`e2e`, the desktop smoke, `web-node-next`) is advisory: a red one is a real finding but blocks nothing. Never call an advisory check a gate, and never read a green headline as "the ride passed".
- `changelog` always reports (`skipping` on an exempt PR), so it can be required. `e2e` is path-filtered and never reports on a docs-only PR, so requiring it needs a skip-shim job first. `web-node-next` joins `web` when Node 26 is Active LTS.
