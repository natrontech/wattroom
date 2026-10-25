#!/bin/sh
# PreToolUse guard for Bash (#4077): a foreground `sleep` over 5 s is a poll,
# and every poll is a turn that re-reads the whole context (#3970). Background
# commands may sleep; short settles (sleep 2) pass.
input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.tool_input.run_in_background // false')" = true ] && exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
# Only a sleep in command position counts, so `grep "sleep 300"` passes.
printf '%s\n' "$cmd" | grep -oE '(^|[;&|(]|[[:space:]](do|then|else))[[:space:]]*sleep[[:space:]]+([0-9.]+[smhd]?|infinity)' |
	grep -oE '[^[:space:]]+$' | awk '/[mhd]$|infinity/ || $0 + 0 > 5 { found = 1 } END { exit !found }' || exit 0
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"A sleep over 5 s polls, and each poll re-reads the whole context (#3970). Wait for CI with scripts/wait-checks.sh <pr> (timeout 600000), or run the command with run_in_background and wait for its notification."}}'
