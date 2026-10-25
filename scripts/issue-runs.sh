#!/usr/bin/env bash
# Work the queue one issue per fresh Claude session: the issue-run skill, or the
# skill RUN names (RUN=/pickup-feedback). A /loop session carries every earlier
# issue in its context and pays about twice the tokens per merge (#3970).
#
# usage:  [AGENT_INDEX=0 AGENT_COUNT=2] scripts/issue-runs.sh [claude flags...]
#   e.g. scripts/issue-runs.sh --permission-mode auto
#   Several runners side by side: one per AGENT_INDEX, from one clone on main.
#   No --max-budget-usd or --max-turns: a run cut off mid-issue keeps its claim,
#   and the skill stands down at two hours on its own.
#   DAILY_USD=40: no new run starts once today's logged cost across all runners
#   reaches it; the runner re-checks every 30 min. Unset: no limit.
#   ISSUE_RUN_SOURCES=2,3,4: issue-run §1 takes only these sources (default all).
#   The cheap setup (#4097): two Sonnet runners on new work and one Opus runner
#   on kept work, so Opus resumes what a Sonnet run stood down from:
#     AGENT_INDEX=0 AGENT_COUNT=2 ISSUE_RUN_SOURCES=2,3,4 scripts/issue-runs.sh --model sonnet
#     AGENT_INDEX=1 AGENT_COUNT=2 ISSUE_RUN_SOURCES=2,3,4 scripts/issue-runs.sh --model sonnet
#     ISSUE_RUN_SOURCES=0,1 scripts/issue-runs.sh --model opus
# status: scripts/issue-runs.sh status (from any checkout)
# stop:   touch ~/.wattroom-runs/STOP (the run in progress finishes first).
set -uo pipefail

runs=~/.wattroom-runs
mkdir -p "$runs"

# Today's logged cost per outcome, from each `== … cost $X` header and the `run:`
# line under it, then the total of every run, including one with no `run:` line.
costs_today() {
	awk '/^== / { c = ($NF ~ /^\$[0-9.]+$/) ? substr($NF, 2) + 0 : 0; t += c }
		/^run:/ { o[$3] += c; c = 0 }
		END { for (k in o) printf "%s $%.2f\n", k, o[k]; printf "total $%.2f\n", t }' \
		"$runs/$(date +%F).log" 2>/dev/null
}

if [ "${1:-}" = status ]; then
	# One phone screen: what runs now, what today brought, what waits on a human.
	pids=$(pgrep -f 'claude -p /' | paste -sd, -)
	echo "running (elapsed, command):"
	if [ -n "$pids" ]; then ps -o etime=,args= -p "$pids" | cut -c1-70; else echo "  nothing"; fi
	echo "today: $(grep -h '^run:' "$runs/$(date +%F).log" 2>/dev/null | awk '{print $3}' | sort | uniq -c | xargs)"
	echo "spend: $(costs_today | paste -sd, - | sed 's/,/, /g') of \$${DAILY_USD:-∞}"
	echo "last runs:"
	grep -h -e '^== ' -e '^run:' "$runs"/*.log 2>/dev/null | tail -n 8
	echo "open issues: $(gh issue list --state open --limit 3000 --json number --jq length)"
	last='.[0] | if .conclusion == "" then .status else .conclusion end'
	echo "main: ci $(gh run list --branch main --workflow ci.yml --limit 1 --json conclusion,status --jq "$last"), e2e $(gh run list --branch main --workflow e2e.yml --limit 1 --json conclusion,status --jq "$last")"
	echo "needs a human: $(gh issue list --state open --label needs-human-input --limit 200 --json number --jq '"\(length), newest " + (map("#\(.number)")[:5] | join(" "))')"
	exit 0
fi

cd "$(git rev-parse --show-toplevel)" || exit 1
export AGENT_INDEX=${AGENT_INDEX:-0} AGENT_COUNT=${AGENT_COUNT:-1} ISSUE_RUN_SOURCES=${ISSUE_RUN_SOURCES:-0,1,2,3,4}
# Opus compacts near 967K of its 1M window. A one-issue session peaks at a median
# 190K and 341K at p90 (#3970), so only a runaway run reaches 400K.
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-400000}
# A run that fails inside two minutes did no work (no auth, no quota, a broken
# flag): wait twice as long after each, and give up after five in a row.
fast_failures=0

while [ ! -e "$runs/STOP" ]; do
	# Each run reads AGENTS.md and the skills from this clone: keep it on main's head.
	git fetch -q origin && [ "$(git branch --show-current)" = main ] && git merge -q --ff-only origin/main ||
		echo "issue-runs: this clone is not a clean main, so the run reads stale rules" >&2
	if [ -n "${DAILY_USD:-}" ]; then
		spent=$(costs_today | awk '$1 == "total" { print substr($2, 2) }')
		if awk -v s="$spent" -v l="$DAILY_USD" 'BEGIN { exit !(s >= l) }'; then
			echo "issue-runs: \$$spent of \$$DAILY_USD spent today; waiting" >&2
			sleep 1800
			continue
		fi
	fi
	started=$(date +%s)
	err=$(mktemp)
	json=$(claude -p "${RUN:-/issue-run}" --output-format json "$@" 2>"$err")
	status=$? cost=
	# A run that dies before printing its JSON logs its raw output, as before.
	if out=$(jq -er .result <<<"$json" 2>/dev/null); then
		cost=$(jq -r '.total_cost_usd // empty | "$\(.)"' <<<"$json")
	else
		out=$(cat - "$err" <<<"$json")
	fi
	rm -f "$err"
	printf '== %s runner %s exit %s cost %s\n%s\n' "$(date '+%F %H:%M')" "$AGENT_INDEX" "$status" "${cost:-?}" "$out" >>"$runs/$(date +%F).log"
	case $out in
	*"run: queue empty"*) sleep 1800 ;;
	*)
		if [ "$status" -eq 0 ] || [ $(($(date +%s) - started)) -ge 120 ]; then
			fast_failures=0
			[ "$status" -eq 0 ] || sleep 300
		else
			fast_failures=$((fast_failures + 1))
			if [ "$fast_failures" -ge 5 ]; then
				echo "issue-runs: $fast_failures runs failed within two minutes; stopping. Last output:" >&2
				printf '%s\n' "$out" | tail -n 5 >&2
				exit 1
			fi
			sleep $((300 * 2 ** (fast_failures - 1)))
		fi
		;;
	esac
done
