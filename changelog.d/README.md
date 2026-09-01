# changelog.d — one file per change, collated at release

Every pull request that a rider could notice drops **one file** in here instead
of editing `CHANGELOG.md`. `make release` collates them into the new version's
section, in Keep a Changelog order, and deletes them.

    changelog.d/<category>-<short-slug>.md

`<category>` is one of `added` `changed` `deprecated` `removed` `fixed`
`security`. The file holds the bullet exactly as it should appear:

    - What's new no longer goes blank. Any release note that used the same code
      span twice in one line took the whole page down with it.

Write it for someone deciding whether to upgrade — not as a second copy of the
PR title. Wrap at 80 and indent continuation lines by two spaces, like the
entries already in `CHANGELOG.md`.

## Why not just edit CHANGELOG.md

Because eight agents work here at once and they all appended to the same few
lines under `## [Unreleased]`. That produced three failures in a single day:
every second PR conflicted; a conflict resolved carelessly during a rebase
silently drops somebody's entry; and #366, #367, #368 and #370 were four
consecutive PRs whose only purpose was repairing the changelog afterwards.

One file per PR makes the conflict impossible rather than merely rare — two
authors never touch the same path. It also makes a pending entry a *file*, so
a PR that removes a feature can delete the entry that describes it, which is
the mistake #370 had to clean up by hand.
