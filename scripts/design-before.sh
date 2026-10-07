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
set -eu

out=${1:?usage: design-before.sh <out-dir>}
case $out in /*) ;; *) out="$PWD/$out" ;; esac
git fetch --quiet origin main
base=$(git merge-base origin/main HEAD)

runs=$(gh run list --workflow design-shots.yml --branch main --event push --limit 50 \
	--json databaseId,headSha,status,conclusion \
	--jq '.[] | "\(.databaseId) \(.headSha) \(.status) \(.conclusion)"')

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
