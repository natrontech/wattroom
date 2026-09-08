#!/bin/bash
# Cut a desktop release: bump desktop/package.json, tag, push. Run it as
# `make desktop-release` (ADR-0037, amended 2026-09-08).
#
# Versions are CalVer like the server's (ADR-0019) — YYYY.0M.MICRO, computed
# from the tags that already exist — in their own namespace: the tag is
# desktop-v2026.09.1, and desktop-release.yml builds, signs and publishes it to
# natrontech/wattroom-releases. The two trains stay uncoupled on purpose: the
# shell loads the deployed web app, so the interface ships with every server
# release and a desktop release only happens when desktop/ changes.
#
# The number has to be written into desktop/package.json before the tag: the
# workflow's guard refuses a tag that disagrees with it, because the shell
# reports that file's version as window.wattroom.version and the update notice
# compares it against the newest tag. main's ruleset rejects direct pushes, so
# the bump goes through a pull request this script opens, merges and tags —
# the same path scripts/release.sh takes for the changelog.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# Cut from main's tip, wherever that is checked out (see release.sh). --tags,
# so a desktop-v tag pushed from another machine cannot be numbered twice.
git fetch -q --tags origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
	echo "desktop releases are cut from origin/main's tip; HEAD is $(git rev-parse --short HEAD), origin/main is $(git rev-parse --short FETCH_HEAD)" >&2
	echo "on main: git pull --ff-only; in a worktree: git checkout --detach origin/main — then run this again" >&2
	exit 1
fi
if [ -n "$(git status --porcelain desktop/package.json)" ]; then
	echo "desktop/package.json has uncommitted changes — commit or drop them first" >&2
	exit 1
fi

# This month's desktop tags decide the next number.
month=$(date +%Y.%m)
last=$(git tag --list "desktop-v$month.*" | sed 's/^desktop-v//' | awk -F. '{print $3}' | sort -n | tail -1)
version="$month.$((${last:-0} + 1))"
tag="desktop-v$version"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
	echo "$tag already exists" >&2
	exit 1
fi
prev=$(git tag --list 'desktop-v*' --sort=-creatordate | head -1)
echo "cutting $tag (previous: ${prev:-none})"

branch="release/$tag"
git checkout -q -b "$branch"
# node, not `pnpm version`: pnpm validates semver, and semver forbids the
# leading zero in 2026.09.1. The file is 2-space JSON, so the diff is one line.
node -e '
const fs = require("fs");
const p = "desktop/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.version = process.argv[1];
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
' "$version"
git add desktop/package.json
git commit -qm "chore(desktop): release $version"
git push -q -u origin "$branch"

gh pr create --base main --head "$branch" --title "chore(desktop): release $version" \
	--label no-changelog \
	--body "Cut by \`make desktop-release\`. Writes $version into \`desktop/package.json\` so \`desktop-release.yml\`'s guard accepts the tag \`$tag\`; the tag follows the merge and publishes the installers to natrontech/wattroom-releases. Previous desktop release: ${prev:-none}."

# Detach rather than checking out main (release.sh says why), then wait for
# the state that actually gates the merge — `mergeable` says MERGEABLE while
# the checks are still running.
git checkout -q --detach
for _ in $(seq 120); do
	state=$(gh pr view "$branch" --json mergeStateStatus --jq .mergeStateStatus)
	case "$state" in
	CLEAN | UNSTABLE) break ;;
	DIRTY)
		echo "release PR conflicts with main ($state) — close it, delete its branch, and run make desktop-release again" >&2
		exit 1
		;;
	esac
	sleep 10
done
gh pr merge "$branch" --squash

# Tag the merged commit directly; nothing here needs main checked out.
git fetch -q origin main
git tag -a "$tag" -m "$tag" FETCH_HEAD
git push -q origin "$tag"
git push -q origin --delete "$branch" 2>/dev/null || true
git branch -q -D "$branch" 2>/dev/null || true

if git checkout -q main 2>/dev/null; then
	git merge -q --ff-only FETCH_HEAD 2>/dev/null || true
else
	echo "note: left on a detached HEAD — main is checked out in another worktree"
fi
echo "$tag tagged and pushed — desktop-release.yml builds, signs and publishes it to natrontech/wattroom-releases"
