#!/bin/bash
# Cut a release: promote the changelog, tag, push. Run it as `make release`
# (ADR-0019).
#
# Versions are CalVer, YYYY.0M.MICRO — 2026.09.1, then 2026.09.2, and MICRO
# back to 1 next month. The number is computed from the tags that already
# exist, so there is nothing to pass and nothing to get wrong; WattRoom ships
# continuously to one VM, and "which month is this from" is the question a
# version can actually answer here. What changed is the changelog's job.
#
# The changelog is promoted *before* the tag so the tag points at a tree whose
# CHANGELOG.md already describes that release — publish.yml then reads the
# section back out for the GitHub Release body, and the two cannot disagree.
#
# The promotion goes through a pull request because main's ruleset rejects
# direct pushes (GH013). It needs no approvals, so this merges it and then tags
# the resulting main commit; tags are not covered by the ruleset.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
[ "$(git branch --show-current)" = main ] || {
	echo "releases are cut from main; you are on $(git branch --show-current)" >&2
	exit 1
}
[ -z "$(git status --porcelain)" ] || {
	echo "working tree is dirty — commit or stash first" >&2
	exit 1
}
# An empty Unreleased means nobody wrote down what changed, which is the whole
# thing this is meant to prevent. Better to stop than to ship a blank release.
if ! awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f && NF' CHANGELOG.md | grep -q .; then
	echo "## [Unreleased] in CHANGELOG.md is empty — nothing to release" >&2
	exit 1
fi

# This month's tags decide the next number. `git describe` gives the previous
# release in commit order, which is what the compare link wants — sorting tag
# names would pick the wrong one the first time a month rolls over.
month=$(date +%Y.%m)
last=$(git tag --list "$month.*" | awk -F. '{print $3}' | sort -n | tail -1)
version="$month.$((${last:-0} + 1))"
prev=$(git describe --tags --abbrev=0 2>/dev/null || true)
today=$(date +%F)

if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
	echo "$version already exists" >&2
	exit 1
fi
echo "cutting $version (previous: ${prev:-none})"
repo_url=https://github.com/natrontech/wattroom

# Promote: the new heading slots in directly under [Unreleased], so everything
# written there becomes this release and Unreleased is left empty.
tmp=$(mktemp)
if ! { awk -v v="$version" -v d="$today" -v prev="$prev" -v url="$repo_url" '
	/^## \[Unreleased\]/ {
		print; print ""; print "## [" v "] - " d
		next
	}
	/^\[Unreleased\]:/ {
		print "[Unreleased]: " url "/compare/" v "...HEAD"
		if (prev == "") print "[" v "]: " url "/releases/tag/" v
		else print "[" v "]: " url "/compare/" prev "..." v
		next
	}
	{ print }
' CHANGELOG.md >"$tmp" && mv "$tmp" CHANGELOG.md; }; then
	rm -f "$tmp"
	echo "could not rewrite CHANGELOG.md" >&2
	exit 1
fi

branch="release/$version"
git checkout -q -b "$branch"
git add CHANGELOG.md
git commit -qm "docs: release $version"
git push -q -u origin "$branch"

# The PR body is the release's own changelog section, so the thing being
# reviewed says what it is.
notes=$(mktemp)
awk -v v="$version" '
	index($0, "## [" v "]") == 1 { f = 1; next }
	/^## \[/ || /^\[[^]]+\]:/ { f = 0 }
	f
' CHANGELOG.md >"$notes"
gh pr create --base main --head "$branch" --title "docs: release $version" --body-file "$notes"
rm -f "$notes"

# Step off the branch first so --delete-branch can remove it locally too.
git checkout -q main
# Zero approvals are required, but mergeability takes a moment to compute.
for _ in $(seq 30); do
	[ "$(gh pr view "$branch" --json mergeable --jq .mergeable)" = MERGEABLE ] && break
	sleep 2
done
gh pr merge "$branch" --squash --delete-branch
git pull -q --ff-only
git tag -a "$version" -m "$version"
git push -q origin "$version"
echo "$version tagged and pushed — publish.yml builds the image and cuts the release"
