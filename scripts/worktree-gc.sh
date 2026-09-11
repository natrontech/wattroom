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

# How long a worktree carrying nothing is taken to be somebody's live claim
# rather than litter. Generous on purpose, because the two costs are nothing
# alike: keeping litter another day is a line of output, and removing a claim
# is whatever that agent had not committed yet. Only the `ahead == 0` case
# consults it — a squash-merged worktree is still removed the moment its PR
# lands, however new it is.
fresh_minutes=720

# Minutes since `git worktree add` wrote this worktree's `.git` file. That file
# is written once and never rewritten; the directory's own mtime is not, since
# every build output moves it. An unreadable one reads as brand new, because
# the safe answer when the age cannot be told is to keep.
minutes_old() {
	local born
	born=$(stat -f %m "$1/.git" 2>/dev/null || stat -c %Y "$1/.git" 2>/dev/null || true)
	if [ -z "$born" ]; then
		echo 0
		return
	fi
	echo $((($(date +%s) - born) / 60))
}

main_tree=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
# Running `make worktree-gc` from inside a worktree must not delete the ground
# it stands on: a fresh one has nothing beyond origin/main and so looked
# exactly like litter (#2115).
self=$PWD
removed=0 kept=0 strand_warned=0 orphans=()

while read -r dir; do
	[ "$dir" = "$main_tree" ] && continue
	if [ "$dir" = "$self" ]; then
		echo "keep    ${dir##*/} — you are running from it"
		kept=$((kept + 1))
		continue
	fi
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
		# ...which is also exactly what an agent looks like between
		# `git worktree add` and its first commit, and AGENTS.md step 1 tells
		# every contributor to read that branch name and stay off it (#2116).
		# To git the two are one clean tree at origin/main, so age is the only
		# thing telling them apart — and this script's promise, that it removes
		# only what is finished, means the young one is reported, not swept.
		age=$(minutes_old "$dir")
		if [ "$age" -lt "$fresh_minutes" ]; then
			echo "keep    $name — ${age}m old on $branch, may be a claim in progress"
			kept=$((kept + 1))
			continue
		fi
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

	# Before the removal, never after: the database name is derived from this
	# worktree's absolute path (scripts/dev-env.sh), and dev-env.sh computes it
	# by running inside the worktree. Remove the directory first and the name
	# cannot be reconstructed from anything that still exists (#2105).
	# A failure here is worth saying out loud: swallowing it is exactly how two
	# databases were stranded with no way back to their names. The common cause
	# is a second postgres container left behind by some other checkout, which
	# makes dev-env.sh refuse to guess.
	if ! drop_out=$( (cd "$dir" && ./scripts/dev-env.sh drop-db) 2>&1); then
		echo "  ! $name — databases NOT dropped: $(tail -1 <<<"$drop_out")"
		echo "    they can no longer be named once this worktree is gone"
		strand_warned=1
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

# Databases stranded before this script learned to drop them, or by a hand
# `git worktree remove`. Named, never dropped: a second clone of this repo on
# the same machine has databases this clone's worktree list cannot see, and
# they look identical from here.
claimed=$(
	while read -r d; do
		[ -d "$d" ] || continue
		(cd "$d" && ./scripts/dev-env.sh print 2>/dev/null) |
			# Two expressions, not one with \(TEST_\)\? — `\?` is a GNU extension and
			# BSD sed takes it literally, so on macOS this matched nothing, left
			# `claimed` empty, and reported every live database as stranded (#2115).
			sed -n \
				-e "s/^export WATTROOM_DEV_DB_NAME='\(.*\)'$/\1/p" \
				-e "s/^export WATTROOM_DEV_TEST_DB_NAME='\(.*\)'$/\1/p"
	done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')
)
# `docker ps | head -1` picked a leftover container from a removed worktree and
# reported one stranded database out of eleven. dev-env.sh owns this answer.
# An empty claimed set with worktrees present means the lookup broke, not that
# everything is litter — and this report prints a `dropdb --force` beside
# whatever it names. Say nothing rather than hand over a destructive command
# built on a failed detection (#2115).
if [ -z "$claimed" ]; then
	echo
	echo "Could not work out which databases are in use — skipping the stranded report."
	echo "    (scripts/dev-env.sh print returned no database names)"
elif container=$(./scripts/dev-env.sh pg-container 2>/dev/null); then
	stranded=$(
		docker exec "$container" psql -U wattroom -lqt 2>/dev/null |
			awk -F'|' '{gsub(/ /,"",$1); if ($1 ~ /^wattroom_(test_)?wt_/) print $1}' |
			grep -vxF "$claimed" || true
	)
	if [ -n "$stranded" ]; then
		echo
		echo "Databases no worktree here claims — check no other checkout is using them:"
		sed 's/^/    /' <<<"$stranded"
		echo "    docker exec $container dropdb -U wattroom --if-exists --force <name>"
	fi
fi

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
