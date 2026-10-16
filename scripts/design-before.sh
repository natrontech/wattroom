#!/bin/sh
# Main's design shots for this branch, without capturing main here (#3858):
# the artifact .github/workflows/design-shots.yml uploads for each push to
# main, taken for the merge base, or else for the newest main commit before it
# that draws the same (nothing under web/ or server/internal/og changed in
# between, the workflow's own paths).
#
# Usage: scripts/design-before.sh <out-dir>   (run directly: make would fold
#        the two exit codes below into its own 2)
# Exit 1: no such artifact; DESIGN-CHECK.md says how to capture main locally.
# Exit 2: the merge base's own run is still going; its id is printed, so
#         `gh run watch <id>` can wait for it in the background.
#
# Usage: scripts/design-before.sh --base
#        prints the newest main commit at or after the merge base whose shots
#        are finished. Merged into the branch before its capture, it is the
#        merge base, so the fetch above finds its artifact at once. Main's
#        head is usually still being shot: rebasing on it left 25 of 27 checks
#        waiting on CI or capturing main again (#4064).
# Exit 1: none yet; capture and fetch as the branch stands.
set -eu

base_only=''
if [ "${1:-}" = --base ]; then
	base_only=1
else
	out=${1:?usage: design-before.sh <out-dir> | --base}
	case $out in /*) ;; *) out="$PWD/$out" ;; esac
fi
git fetch --quiet origin main
base=$(git merge-base origin/main HEAD)

runs=$(gh run list --workflow design-shots.yml --branch main --event push --limit 50 \
	--json databaseId,headSha,status,conclusion \
	--jq '.[] | "\(.databaseId) \(.headSha) \(.status) \(.conclusion)"')

if [ -n "$base_only" ]; then
	while read -r id sha status conclusion; do
		[ -n "$id" ] && [ "$status" = completed ] || continue
		case $conclusion in success | failure) ;; *) continue ;; esac
		git cat-file -e "$sha^{commit}" 2>/dev/null || continue
		git merge-base --is-ancestor "$base" "$sha" || continue
		# The merge job uploads nothing when every shard failed.
		gh api "repos/{owner}/{repo}/actions/runs/$id/artifacts" --jq '.artifacts[].name' |
			grep -qx "design-shots-$sha" || continue
		echo "$sha"
		exit 0
	done <<EOF
$runs
EOF
	echo "no finished design shots on main at or after $base: capture and fetch as the branch stands" >&2
	exit 1
fi

pending=''
while read -r id sha status conclusion; do
	[ -n "$id" ] || continue
	git cat-file -e "$sha^{commit}" 2>/dev/null || continue
	git merge-base --is-ancestor "$sha" "$base" || continue
	git diff --quiet "$sha" "$base" -- web server/internal/og || continue
	if [ "$status" != completed ]; then
		pending=$id
		continue
	fi
	# A failed run still uploads every surface it shot; one it could not shoot
	# is a FAILED-<id>.png there, and that one is captured locally.
	case $conclusion in success | failure) ;; *) continue ;; esac
	mkdir -p "$out"
	if gh run download "$id" --name "design-shots-$sha" --dir "$out" >/dev/null 2>&1; then
		echo "before: main at $sha (run $id, $conclusion) in $out"
		exit 0
	fi
done <<EOF
$runs
EOF

if [ -n "$pending" ]; then
	echo "main's design shots for $base are still being taken: run $pending" >&2
	echo "$pending"
	exit 2
fi
echo "no design-shots artifact draws main as $base does: capture main locally (DESIGN-CHECK.md, step 4)" >&2
exit 1
