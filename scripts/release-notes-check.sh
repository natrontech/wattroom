#!/bin/bash
# Checks release.sh's notes step against a throwaway repo, on the Mac's
# bash 3.2: scripts/release-notes-check.sh scripts/release.sh
set -euo pipefail
script=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
R=$(mktemp -d)
cd "$R"
git init -q
git config user.email t@t
git config user.name t
c() {
	if [ $# -gt 1 ]; then git commit -q --allow-empty -m "$1" -m "$2"; else git commit -q --allow-empty -m "$1"; fi
}
c 'chore: start'
git tag 2026.11.1
c 'feat(web): a plain feature (#1)'
c 'fix(e2e): an internal test fix (#2)'
c 'fix(hub): short subject (#3)' 'Changelog: A ride keeps its length when the trainer drops a reading.'
c 'feat(web): hidden one (#4)' 'Changelog: -'
c 'perf(web): faster world (#5)'
c 'fix(deps): bump (#6)'
c 'fix(web): squashed (#7)' $'* fix(web): first\n\n  Changelog: Indented in a squash body.'
c 'feat(web): two commits (#8)' $'* feat(web): the change\n\nChangelog: The real line.\n\n* fix(web): a follow-up\n\nChangelog: -'
prev=2026.11.1
eval "$(sed -n '/^entries() {/,/^}/p' "$script")"
out=$(for t in feat perf fix; do echo "[$t]"; entries "$t"; done)
echo "$out"
want=$'[feat]\nThe real line. (#8)\na plain feature (#1)\n[perf]\nfaster world (#5)\n[fix]\nIndented in a squash body. (#7)\nA ride keeps its length when the trainer drops a reading. (#3)'
[ "$out" = "$want" ] && echo PASS || { echo FAIL; exit 1; }
