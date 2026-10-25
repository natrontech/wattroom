#!/bin/sh
# PostToolUse formatter for Edit|Write (#4077). Formats with the tools of the
# edited file's own checkout, so an edit in a worktree uses that worktree's
# web/node_modules, not the session's. A failure prints one line and exits 2,
# which shows it to the agent instead of leaving the file silently unformatted.
f=$(jq -r '.tool_input.file_path // empty')
case $f in
*.go) out=$(gofmt -w "$f" 2>&1) || { echo "format: gofmt failed on $f: $out" | head -n 1 >&2; exit 2; } ;;
*/web/*)
	web=$(git -C "$(dirname "$f")" rev-parse --show-toplevel 2>/dev/null)/web
	if [ ! -x "$web/node_modules/.bin/prettier" ]; then
		echo "format: $f left unformatted, $web has no node_modules: run pnpm install there" >&2
		exit 2
	fi
	out=$(cd "$web" && node_modules/.bin/prettier --write --ignore-unknown "$f" 2>&1) ||
		{ echo "format: prettier failed on $f: $out" | head -n 1 >&2; exit 2; }
	;;
esac
exit 0
