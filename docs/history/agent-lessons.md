# Why the agent rules say what they say

AGENTS.md and `.claude/rules/` state rules; this file keeps the incidents that earned them. Read it before arguing a rule away.

## Taking work

- **Check `gh pr list`, not only the issue.** Agents open a draft without commenting, so a quiet issue is not an idle one. One feature shipped twice that way (#280, then #284 and #294).
- **Read `git worktree list`.** A fresh worktree has no ref and no PR for the other checks to find; one test was written three times (#297, #302, #304, #305). `make worktree-gc` reports young clean worktrees instead of sweeping them for the same reason (#2116).
- **Branch before you comment.** The branch is the only claim signal that appears instantly. #1003 and #267 were both lost in the gap between a clean `gh issue view` and a claim comment.
- **Claim before you code.** An agent that codes first has already spent the hours the check exists to save (#427).
- **Say "proceed" when standing down.** Two agents that each defer to the other leave the issue undone, which costs more than a duplicate.
- **A worktree, not just a branch.** Several sessions drive one clone; `HEAD` belongs to whoever moved it last, so a neighbour's checkout of `main` moves you mid-task and their `git add -A` sweeps up your files. Happier sessions already start in a worktree, and opening a second one beside it split the work (#3718).
- **No direct pushes.** The convention-only rule from #7 became a ruleset (`GH013`).

## Worktrees and infrastructure

- **Per-worktree ports and databases** (#552): two agents testing at once deleted each other's rows and both went red while CI stayed green.
- **Per-checkout is not per-run**: fixtures collided inside one `go test ./...` (#2083) and were swept by a retention job (#2080).
- **One compose project, `wattroom`** (#2107): a project named after its worktree was removed with that worktree and took every database with it (#2105); the one left behind gave `dev-env.sh` two postgres containers and stopped every checkout on the machine.
- **`make migration`, never a typed number**: two branches took the same number and `main` did not boot (#928).
- **sqlc stars count as use** (#2836): `select *` expands to every column, so dropping one a star covers breaks the previous image.

## Git

- **Closing keywords**: one issue was closed three times by PRs that meant nothing of the kind: a negated keyword in a body, a quoted one in the commit explaining that, and a past-tense one in the PR amending the rule, because the rule and its grep listed only the `-s` forms. Code fences don't help. What it cost: a hardware validation nobody had performed read as done.
- **Squash subject**: #2341 was retitled `fix:` but landed as `feat:` from its only commit's subject, permanently.
- **`statusCheckRollup`**: #1061, #1073 and #1115 read red on superseded runs and were green; two were briefly mistaken for the changelog gate being bypassed (#1043).
- **`changelog` is required, `e2e` is not**: a required context must always report (#1044, #1045); `e2e` never starts on a docs-only PR, which would jam every docs PR and `make release`. `web-node-next` stays advisory by decision (#2074).
- **One changelog file per PR**: eight agents appending to one section conflicted constantly, and careless rebases dropped entries.

## Errors and UX

- **One error vocabulary**: `jukebox_queue_full` and six siblings told a client nothing the closed set didn't (audit, 2026-09-17).
- **Refused taps answer** where the rider watches for a result (#1762, #2232).
- **Confirm by undo-ability** (#1493): a coach's token and a calendar link break someone else's tooling without destroying data. An expander only says where a control is, not what it breaks. The confirm's wording is owned by `confirm()` (#2887).
- **Measured SVG widths**: a `width={W}` beside `bind:clientWidth` latched at 600 px on a 375 px phone (#1008).
- **`documentElement.scrollWidth`**: the shell's `overflow-hidden` columns absorbed a chart 307 px too wide and left the check green.
- **Route registry**: a route missing from `e2e/routes.ts` was never measured (#2386).
- **Tap targets**: a flat 44 px rule condemned every button in the app, the default one included, and was ignored (#1088).
- **Find every consumer**: #1016's `ridingLocked` had a third caller nobody named, the gauge the deploy guard refuses to restart under.
- **Data tables are exempt from the size ceiling** (#3358): cutting a list in two makes it harder to read.
- **`/dev/perf` for endless animation**: a glow over moving content cost a third of a GPU before anyone measured it.
- **Mute before you play**: `board` defaults to 0.7, so a mixer write without it made the soundboard audible while the rule looked obeyed (#990); `share` at 1 did the same for screen-share audio.
