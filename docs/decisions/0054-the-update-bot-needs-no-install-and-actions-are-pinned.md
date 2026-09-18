# ADR-0054 — The update bot is the one a merge can turn on, and every action it bumps is pinned to a commit

- Status: accepted
- Date: 2026-09-18

## Context

Two problems that look unrelated and are the same problem: the repository was
trusting things it did not control.

**The update bot that never ran.** [RESEARCH.md §7](../RESEARCH.md) chose
Renovate over Dependabot on real merits — 90+ ecosystems including Docker
Compose and Helm, built-in automerge, and regex managers for versions embedded
in Dockerfiles and CI, all of which exist in this repository. `renovate.json`
was committed with the first CI workflow. Renovate is a GitHub App, so
[#9](https://github.com/natrontech/wattroom/issues/9) asked someone to install
it, and sat open in `backlog` for two months.

In that time `gh pr list --author app/renovate --state all` returned nothing.
Not a worse bot — no bot. Meanwhile eight direct Go modules, eleven npm
packages and the whole `desktop/` tree drifted, and the Dockerfile went on
building the shipped SPA on `node:22-alpine` while `ci.yml`'s `web` job had
moved to Node 24: the bundle riders download was produced by an interpreter two
majors behind the only one the suite was ever green on, and nothing could say
so, because `publish.yml` builds the image on pushes to `main` and on tags but
never on a pull request.

**The actions nobody pinned.** Every `uses:` in `.github/workflows/` named a
tag — 31 lines, 7 workflows, 11 actions. A tag is a movable pointer in someone
else's repository. Whoever can push to it can replace the code that runs inside
every job here, on every branch, with the secrets those jobs hold, and nothing
in this repository changes, so nothing here notices. `tj-actions/changed-files`
was turned against thousands of repositories in 2025 exactly that way, by
repointing tags that had never moved before.

The blast radius is not theoretical: `publish.yml` carries `packages: write`
and `contents: write` and pushes the image production pulls;
`desktop-release.yml` carries the Apple signing and notarization credentials
([ADR-0037](0037-a-desktop-shell-for-what-the-browser-cannot-reach.md)).

## Decision

**A capability that depends on somebody else's admin action is a capability
this repository does not have.** So the update bot is Dependabot, activated by
`.github/dependabot.yml` on the default branch and nothing else, and
`renovate.json` is deleted rather than kept beside it — two bots means two pull
requests per bump.

**Where a format allows a dependency to be named by a commit rather than a
tag, it is.** Every action is `owner/repo@<40-hex> # vX.Y.Z`, and `ci.yml`'s
`docs` job fails the build on a `uses:` that is not. `docs` is required on
`main`'s ruleset and carries no paths filter, so a workflow-only pull request
is still checked.

The cadence is chosen so the mailbox stays worth reading: **monthly**, one
grouped pull request per ecosystem for everything minor and patch, majors
alone because each is a judgement call, and a hard cap on open pull requests.
Security updates ignore all of it — Dependabot opens those immediately, which
is the correct asymmetry and the same one `vulncheck` already has for Go.

Four ecosystems: `gomod` in `/server`, `npm` in `/web` and `/desktop`,
`github-actions` in `/`. No `docker`: the only image that ships is
`gcr.io/distroless/static-debian12:nonroot`, a floating tag already resolved
fresh on every build, and the `node:`/`golang:` stages above it are builders
discarded in the same Dockerfile.

## Consequences

- **Renovate's regex managers are genuinely lost, and nothing replaces them.**
  Nothing now watches a version embedded in a Dockerfile or a workflow: the
  LiveKit tag written by hand into `docker-compose.yml`,
  `deploy/docker-compose.prod.yml` and `e2e.yml`, and the Dockerfile's `node:`
  and `golang:` build stages. Those are a human's edit, in more than one file
  at once. Recorded where someone will trip over it — RESEARCH.md §6 beside the
  LiveKit pin, and in `.github/dependabot.yml`. Worth revisiting if anyone ever
  installs the app.
- **Every bot pull request carries `no-changelog` from the moment it is
  opened.** The `changelog` context is required and matches any path under
  `server/` or `web/src/`, which is every `go.mod` bump; a bot can neither
  write a changelog entry nor label its own pull request afterwards, so
  creation time is the only moment this can be applied. A bump a rider should
  hear about has the label removed by hand and an entry added — `changelog.yml`
  triggers on `unlabeled` and re-reports, the path
  [#1044](https://github.com/natrontech/wattroom/issues/1044) opened.
- **The `github-actions` group must stay grouped.** A tag pin moved only on a
  major; a commit pin moves on every patch. Ungrouped, the quietest ecosystem
  in the file becomes the noisiest.
- **The pin survives only because the check does.** One contributor typing
  `@v4` out of habit undoes all of it silently, and no other gate would care.
  The check rejects a bare SHA without its `# vX.Y.Z` comment too: the comment
  is what tells a reader the pin's age, and it is what Dependabot rewrites.
- **A hand-sweep of `web/` wedges the npm updater for three days.** Dependabot
  resolves the pnpm lockfile under a 72-hour maturity gate that pnpm applies to
  every direct dependency, not only the one in the job — so a package taken the
  day after its release blocks every `web/` update until it matures, and names
  itself in an error about an unrelated package. It clears itself; the note is
  in `.github/dependabot.yml` so the red run is read rather than debugged.
- Nothing here changes what a release is or how one is cut
  ([ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md)). A bot's pull
  request is an ordinary pull request and merges through the same five required
  contexts as any other.
