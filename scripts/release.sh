#!/bin/bash
# Cut a release: promote the changelog, tag, push. Run it as `make release
# VERSION=v0.4.0` (ADR-0019).
#
# The changelog is promoted *before* the tag so the tag points at a tree whose
# CHANGELOG.md already describes that release — publish.yml then reads the
# section back out for the GitHub Release body, and the two cannot disagree.
set -euo pipefail

version=${1:-}
[ -n "$version" ] || {
	echo "usage: make release VERSION=vX.Y.Z" >&2
	exit 1
}
printf '%s' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
	echo "'$version' is not a release tag (want vX.Y.Z)" >&2
	exit 1
}

cd "$(git rev-parse --show-toplevel)"
[ "$(git branch --show-current)" = main ] || {
	echo "releases are cut from main; you are on $(git branch --show-current)" >&2
	exit 1
}
[ -z "$(git status --porcelain)" ] || {
	echo "working tree is dirty — commit or stash first" >&2
	exit 1
}
if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
	echo "$version already exists" >&2
	exit 1
fi

# An empty Unreleased means nobody wrote down what changed, which is the whole
# thing this is meant to prevent. Better to stop than to ship a blank release.
if ! awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f && NF' CHANGELOG.md | grep -q .; then
	echo "## [Unreleased] in CHANGELOG.md is empty — nothing to release" >&2
	exit 1
fi

prev=$(git describe --tags --abbrev=0 2>/dev/null || true)
today=$(date +%F)
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

git add CHANGELOG.md
git commit -qm "docs: release $version"
git tag -a "$version" -m "$version"
git push -q origin main "$version"
echo "$version tagged and pushed — publish.yml builds the image and cuts the release"
