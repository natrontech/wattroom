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

	# "Has the remote ever seen this?" is `refs/remotes/origin/<branch>`, NOT the
	# upstream. `git worktree add -b x origin/main` sets the upstream to
	# origin/main, so a branch nobody has pushed still has one — which read as
	# in-flight and hid the orphan this script exists to catch.
	if [ "$ahead" -eq 0 ]; then
		reason="nothing beyond origin/main"
	elif [ -z "$branch" ]; then
		orphans+=("$dir|detached HEAD|$ahead")
		kept=$((kept + 1))
		continue
	elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
		echo "keep    $name — $ahead commit(s) in flight"
		kept=$((kept + 1))
		continue
	elif git for-each-ref --format='%(upstream)' "refs/heads/$branch" |
		grep -qx "refs/remotes/origin/$branch"; then
		# Its own remote branch was tracked and is now gone: squash-merged and
		# deleted, which is what `gh pr merge --delete-branch` leaves behind.
		reason="squash-merged, remote branch gone"
	else
		# Commits that exist only here. No remote ref, so no PR and nothing for
		# `gh pr list` or a neighbour's `git worktree list` to find.
		orphans+=("$dir|$branch|$ahead")
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
		IFS='|' read -r d b a <<<"$o"
		echo "    ${d##*/} — $a commit(s) on $b"
		echo "        git -C $d push -u origin $b"
		echo "        # or, if it is genuinely dead: git worktree remove --force $d"
	done
	exit 1
fi
