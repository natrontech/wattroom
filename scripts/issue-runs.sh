#!/usr/bin/env bash
# Work the queue one issue per fresh Claude session: the issue-run skill, or the
# skill RUN names (RUN=/pickup-feedback). A /loop session carries every earlier
# issue in its context and pays about twice the tokens per merge (#3970).
#
# usage: [AGENT_INDEX=0 AGENT_COUNT=2] scripts/issue-runs.sh [claude flags...]
#   e.g. scripts/issue-runs.sh --permission-mode auto --max-budget-usd 25
#   Several runners side by side: one per AGENT_INDEX, from one clone on main.
# stop:  touch ~/.wattroom-runs/STOP (the run in progress finishes first).
# tally: grep -h '^run:' ~/.wattroom-runs/*.log
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1
runs=~/.wattroom-runs
mkdir -p "$runs"
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
	printf '%s\n' "$out" >>"$runs/$(date +%F).log"
	case $out in
	*"run: queue empty"*) sleep 1800 ;;
	*) [ "$status" -eq 0 ] || sleep 300 ;;
	esac
done
