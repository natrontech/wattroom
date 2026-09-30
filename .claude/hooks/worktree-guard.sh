#!/bin/sh
# PreToolUse guard for Edit|Write|NotebookEdit (#1192, #3718).
#
# AGENTS.md step 4: one task, one worktree, never an edit in the canonical
# clone. Decided by git, not by path prefix: deny only when the target file's
# working tree IS the main tree of this repository. Any linked worktree is
# fine, including a session that STARTS inside one (Happier puts them under
# <repo>/.dev/worktree/<name>). The previous inline check tested "under
# $CLAUDE_PROJECT_DIR", which denied every edit in such a session, and let
# the same session write into the canonical clone above it.
f=$(jq -r '(.tool_input.file_path // .tool_input.notebook_path // empty)')
[ -z "$f" ] && exit 0

# git needs an existing directory, and a Write may be creating new ones.
d=$(dirname "$f")
while [ ! -d "$d" ]; do d=$(dirname "$d"); done

# Both resolved with pwd -P so symlinked paths (/tmp on macOS) compare equal.
common_dir() { cd "$1" 2>/dev/null || return 1; c=$(git rev-parse --git-common-dir 2>/dev/null) || return 1; cd "$c" && pwd -P; }
git_dir() { g=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null) || return 1; cd "$g" && pwd -P; }

fc=$(common_dir "$d") || exit 0                        # not in a git repo: not ours
[ "$fc" = "$(common_dir "$CLAUDE_PROJECT_DIR")" ] || exit 0   # a different repository
[ "$(git_dir "$d")" = "$fc" ] || exit 0                # a linked worktree: allowed

main=$(dirname "$fc")
printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"AGENTS.md requires a worktree, a branch and a draft PR before the first edit (see Working on the issue board). This path is in the canonical clone ($main), not a worktree. Run: git worktree add ../wattroom-worktrees/<slug> -b <type>/<slug>  from $main, then edit inside that worktree. A session that already starts in a linked worktree edits there directly.\"}}"
