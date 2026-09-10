#!/usr/bin/env bash
# Remove the worktrees and branches that are finished, and refuse on anything
# that is not (#2097, AGENTS.md step 7).
#
# The orphan case is the reason this exists rather than an `xargs git worktree
# remove`: a worktree holding commits that were never pushed is finished work
# nobody can find, and one of those turned up in the 2026-09-10 audit. A gc
# that deleted it would be worse than no gc at all, so it shouts and keeps.
#
# Nothing here touches the canonical clone, a dirty tree, or a branch with work
# the remote has not seen.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet --prune origin main 2>/dev/null || true

main_tree=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
removed=0 kept=0 orphans=()

while read -r dir; do
	[ "$dir" = "$main_tree" ] && continue
	name=${dir##*/}

	if [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then
		echo "keep    $name — uncommitted changes"
		kept=$((kept + 1))
		continue
	fi

	branch=$(git -C "$dir" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
	ahead=$(git -C "$dir" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

	if [ "$ahead" -eq 0 ]; then
		reason="nothing beyond origin/main"
	elif [ -n "$branch" ] && [ -z "$(git for-each-ref --format='%(upstream)' "refs/heads/$branch")" ]; then
		# Commits that exist only here: never pushed, so no PR and no ref for
		# anyone to find. This is the case worth a human.
		orphans+=("$name|${branch:-detached}|$ahead")
		kept=$((kept + 1))
		continue
	elif [ -n "$branch" ] && git for-each-ref --format='%(upstream:track)' "refs/heads/$branch" | grep -q gone; then
		reason="squash-merged, remote branch gone"
	else
		echo "keep    $name — $ahead commit(s) in flight"
		kept=$((kept + 1))
		continue
	fi

	git worktree remove --force "$dir"
	echo "removed $name — $reason"
	removed=$((removed + 1))
done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')

git worktree prune

# Branches no worktree holds any more, that the remote has finished with.
held=$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')
pruned=0
while read -r b; do
	[ "$b" = main ] && continue
	grep -qxF "$b" <<<"$held" && continue
	if git merge-base --is-ancestor "$b" origin/main 2>/dev/null ||
		git for-each-ref --format='%(upstream:track)' "refs/heads/$b" | grep -q gone; then
		git branch -D "$b" >/dev/null
		pruned=$((pruned + 1))
	fi
done < <(git branch --format='%(refname:short)')

echo
echo "worktrees: $removed removed, $kept kept · branches: $pruned pruned"

if [ ${#orphans[@]} -gt 0 ]; then
	echo
	echo "NOT removed — these hold commits the remote has never seen:"
	for o in "${orphans[@]}"; do
		IFS='|' read -r n b a <<<"$o"
		echo "    $n ($b, $a commit(s))"
		echo "        git -C .claude/worktrees/$n push -u origin $b   # or delete it deliberately"
	done
	exit 1
fi
