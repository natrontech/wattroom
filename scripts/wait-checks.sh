#!/usr/bin/env bash
# Block until every check on a PR has reported and finished, in one call. Each poll
# an agent runs itself is a turn that re-reads its whole context (#3970), and
# `gh pr checks --watch` alone returns while only `changelog` has reported.
#
# usage: scripts/wait-checks.sh <pr> [minutes]
#   minutes defaults to 9, under an agent's 10-minute call limit; pass more when
#   the call runs in the background.
# exit:  0 every check passed or skipped, 1 one failed or was cancelled (named
#        with its link), 2 still running at the deadline: run it again.
set -uo pipefail

pr=${1:?usage: scripts/wait-checks.sh <pr> [minutes]}
deadline=$(($(date +%s) + ${2:-9} * 60))

while :; do
	# The five required checks (.claude/rules/git.md) must have reported before
	# "nothing pending" means anything.
	state=$(gh pr checks "$pr" --json name,bucket,link --jq '
		if (["server", "web", "vulncheck", "docs", "changelog"] - map(.name) | length) > 0
			or any(.[]; .bucket == "pending") then "pending"
		elif any(.[]; .bucket == "fail" or .bucket == "cancel") then
			"fail " + ([.[] | select(.bucket == "fail" or .bucket == "cancel") | "\(.name) \(.link)"] | join("\n"))
		else "pass" end' 2>/dev/null) || true
	case $state in
	pass)
		echo "all checks passed"
		exit 0
		;;
	fail*)
		echo "${state#fail }"
		exit 1
		;;
	esac
	if [ "$(date +%s)" -ge "$deadline" ]; then
		echo "still running; run it again"
		exit 2
	fi
	sleep 30
done
