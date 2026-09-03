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
# Entries live one-per-file in changelog.d/ so parallel PRs never touch the
# same path; this collates them. The changelog is promoted *before* the tag so the tag points at a tree whose
# CHANGELOG.md already describes that release — publish.yml then reads the
# section back out for the GitHub Release body, and the two cannot disagree.
#
# The promotion goes through a pull request because main's ruleset rejects
# direct pushes (GH013). It needs no approvals, so this merges it and then tags
# the resulting main commit; tags are not covered by the ruleset.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# Cut from main's tip, wherever that is checked out: the primary checkout on
# main, or a worktree detached at origin/main. main is usually checked out in
# another worktree — the reason the rest of this script never checks it out —
# so the guard is the commit, not the branch name.
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
	echo "releases are cut from origin/main's tip; HEAD is $(git rev-parse --short HEAD), origin/main is $(git rev-parse --short FETCH_HEAD)" >&2
	echo "on main: git pull --ff-only; in a worktree: git checkout --detach origin/main — then run this again" >&2
	exit 1
fi
[ -z "$(git status --porcelain)" ] || {
	echo "working tree is dirty — commit or stash first" >&2
	exit 1
}
# No fragments means nobody wrote down what changed, which is the whole thing
# this is meant to prevent. Better to stop than to ship a blank release.
shopt -s nullglob
# Built by appending rather than by expanding a possibly-empty array: `set -u`
# treats "${empty[@]}" as unbound on older bash, and the no-entries path is
# exactly when that bites.
fragments=()
for f in changelog.d/*.md; do
	[ "$(basename "$f")" = README.md ] || fragments+=("$f")
done
if [ ${#fragments[@]} -eq 0 ]; then
	echo "no entries in changelog.d/ — nothing to release" >&2
	echo "every rider-visible PR leaves one there; see changelog.d/README.md" >&2
	exit 1
fi

# A hand-written entry under ## [Unreleased] is no longer read by anything, so
# it would sit there looking published and never reach a release. Catch it
# rather than silently ignore it — silent loss is what changelog.d/ exists to
# prevent, and it would be absurd to reintroduce it here.
if awk '/^## \[Unreleased\]/{f=1;next} /^## \[/ || /^\[[^]]+\]:/{f=0} f && NF' CHANGELOG.md | grep -q .; then
	echo "CHANGELOG.md has hand-written entries under ## [Unreleased]:" >&2
	awk '/^## \[Unreleased\]/{f=1;next} /^## \[/ || /^\[[^]]+\]:/{f=0} f && NF' CHANGELOG.md | sed 's/^/  /' >&2
	echo "" >&2
	echo "Nothing reads them any more. Move each into changelog.d/<category>-<slug>.md" >&2
	echo "and remove them from CHANGELOG.md, then run this again." >&2
	exit 1
fi

# A fragment is a list item, whatever its author typed. Four entries in
# 2026.09.15 were written without their leading "- ", so Markdown folded each
# into the bullet above it and hid whole fixes inside other fixes (#546).
# Normalising here fixes the notes no matter how the file was written: the
# first line becomes a bullet, later lines are indented under it, and trailing
# blank lines never reach the release notes.
normalize_fragment() {
	awk '
		NF { last = NR }
		{ lines[NR] = $0 }
		END {
			for (i = 1; i <= last; i++) {
				line = lines[i]
				if (line ~ /^- /) { bulleted = 1; print line }
				else if (line == "") print line
				else if (!bulleted) { bulleted = 1; print "- " line }
				else if (line ~ /^[ \t]/) print line
				else print "  " line
			}
		}
	' "$1"
}

# Collate: Keep a Changelog order, not filesystem order.
notes=$(mktemp)
for cat in added changed deprecated removed fixed security; do
	files=(changelog.d/"$cat"-*.md)
	[ ${#files[@]} -gt 0 ] || continue
	heading="$(tr '[:lower:]' '[:upper:]' <<<"${cat:0:1}")${cat:1}"
	printf '### %s\n\n' "$heading" >>"$notes"
	for f in "${files[@]}"; do
		normalize_fragment "$f" >>"$notes"
	done
	printf '\n' >>"$notes"
done

# One trailing blank line, not two: each category appends one and the file the
# section is spliced into already starts the next block with one.
trimmed=$(mktemp)
awk 'NF {last = NR} {lines[NR] = $0} END {for (i = 1; i <= last; i++) print lines[i]}' "$notes" >"$trimmed"
mv "$trimmed" "$notes"

# A fragment whose name does not start with a category is silently dropped by
# the loop above, which would lose somebody's entry. Catch it here instead.
counted=$(grep -c '^- ' "$notes" || true)
written=$(for f in "${fragments[@]}"; do normalize_fragment "$f"; done | grep -c '^- ' || true)
if [ "$counted" != "$written" ]; then
	rm -f "$notes"
	echo "some entries in changelog.d/ were not collated — check every filename starts with" >&2
	echo "added-/changed-/deprecated-/removed-/fixed-/security- (see changelog.d/README.md)" >&2
	exit 1
fi

# This month's tags decide the next number. `git describe` gives the previous
# release in commit order, which is what the compare link wants — sorting tag
# names would pick the wrong one the first time a month rolls over.
month=$(date +%Y.%m)
last=$(git tag --list "$month.*" | awk -F. '{print $3}' | sort -n | tail -1)
version="$month.$((${last:-0} + 1))"
# A previous run can have promoted the changelog and then failed before
# tagging — which is exactly what happened cutting 2026.09.1. Re-running would
# otherwise add a second heading for the same version.
if grep -qF "## [$version]" CHANGELOG.md; then
	echo "CHANGELOG.md already has a section for $version — an earlier run promoted it but did not tag." >&2
	echo "Tag that commit by hand, or revert the promotion, then run this again." >&2
	exit 1
fi

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
if ! { awk -v v="$version" -v d="$today" -v prev="$prev" -v url="$repo_url" -v notes="$notes" '
	/^## \[Unreleased\]/ {
		print; print ""; print "## [" v "] - " d; print ""
		while ((getline line < notes) > 0) print line
		close(notes)
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
rm -f "$notes"

git checkout -q -b "$branch"
git add CHANGELOG.md
git rm -q "${fragments[@]}"
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

# Detach rather than checking out main: main is often checked out in another
# worktree, and `git checkout main` fails outright when it is — which is how
# 2026.09.1 got its PR opened and then stopped short of its tag.
git checkout -q --detach
# Zero approvals are required, but mergeability takes a moment to compute.
for _ in $(seq 30); do
	[ "$(gh pr view "$branch" --json mergeable --jq .mergeable)" = MERGEABLE ] && break
	sleep 2
done
gh pr merge "$branch" --squash

# Tag the merged commit directly. Nothing here needs main checked out, so this
# works from any worktree.
git fetch -q origin main
git tag -a "$version" -m "$version" FETCH_HEAD
git push -q origin "$version"
git push -q origin --delete "$branch" 2>/dev/null || true
git branch -q -D "$branch" 2>/dev/null || true

# Back to main, and up to date with what was just merged. This fails harmlessly
# when main is checked out in another worktree — the tag is pushed either way.
if git checkout -q main 2>/dev/null; then
	git merge -q --ff-only FETCH_HEAD 2>/dev/null || true
else
	echo "note: left on a detached HEAD — main is checked out in another worktree"
fi
echo "$version tagged and pushed — publish.yml builds the image and cuts the release"
