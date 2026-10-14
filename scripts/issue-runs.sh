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
# status: scripts/issue-runs.sh status (from any checkout)
# stop:   touch ~/.wattroom-runs/STOP (the run in progress finishes first).
set -uo pipefail

runs=~/.wattroom-runs
mkdir -p "$runs"

if [ "${1:-}" = status ]; then
	# One phone screen: what runs now, what today brought, what waits on a human.
	pids=$(pgrep -f 'claude -p /' | paste -sd, -)
	echo "running (elapsed, command):"
	if [ -n "$pids" ]; then ps -o etime=,args= -p "$pids" | cut -c1-70; else echo "  nothing"; fi
	echo "today: $(grep -h '^run:' "$runs/$(date +%F).log" 2>/dev/null | awk '{print $3}' | sort | uniq -c | xargs)"
	echo "last runs:"
	grep -h -e '^== ' -e '^run:' "$runs"/*.log 2>/dev/null | tail -n 8
	echo "open issues: $(gh issue list --state open --limit 3000 --json number --jq length)"
	last='.[0] | if .conclusion == "" then .status else .conclusion end'
	echo "main: ci $(gh run list --branch main --workflow ci.yml --limit 1 --json conclusion,status --jq "$last"), e2e $(gh run list --branch main --workflow e2e.yml --limit 1 --json conclusion,status --jq "$last")"
	echo "needs a human: $(gh issue list --state open --label needs-human-input --limit 200 --json number --jq '"\(length), newest " + (map("#\(.number)")[:5] | join(" "))')"
	exit 0
fi

cd "$(git rev-parse --show-toplevel)" || exit 1
export AGENT_INDEX=${AGENT_INDEX:-0} AGENT_COUNT=${AGENT_COUNT:-1}
# Opus compacts near 967K of its 1M window. A one-issue session peaks at a median
# 190K and 341K at p90 (#3970), so only a runaway run reaches 400K.
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-400000}

while [ ! -e "$runs/STOP" ]; do
	# Each run reads AGENTS.md and the skills from this clone: keep it on main's head.
	git fetch -q origin && [ "$(git branch --show-current)" = main ] && git merge -q --ff-only origin/main ||
		echo "issue-runs: this clone is not a clean main, so the run reads stale rules" >&2
	out=$(claude -p "${RUN:-/issue-run}" "$@" 2>&1)
	status=$?
	printf '== %s runner %s exit %s\n%s\n' "$(date '+%F %H:%M')" "$AGENT_INDEX" "$status" "$out" >>"$runs/$(date +%F).log"
	case $out in
	*"run: queue empty"*) sleep 1800 ;;
	*) [ "$status" -eq 0 ] || sleep 300 ;;
	esac
done
