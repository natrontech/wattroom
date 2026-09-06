#!/usr/bin/env bash
# A new migration, named for the moment it was written (#928).
#
# Sequence numbers are only correct at the instant a branch merges, and
# nothing can check them at that instant: two branches each pick the next
# free number, each is green on its own, and main is unbootable the moment
# both land — goose panics on a duplicate version before it applies anything.
# It happened with 00036, twice in one evening for the same branch.
#
# A UTC timestamp cannot collide unless two people generate one in the same
# second, and nobody has to guess what the next number is.
set -euo pipefail

name="${1:-}"
if [ -z "$name" ]; then
	echo "usage: scripts/new-migration.sh <slug>   (e.g. rider-timezone)" >&2
	exit 2
fi
slug=$(printf '%s' "$name" | tr '[:upper:] -' '[:lower:]__' | tr -cd '[:alnum:]_')
if [ -z "$slug" ]; then
	echo "that name has no letters or digits in it" >&2
	exit 2
fi

dir="$(cd "$(dirname "$0")/.." && pwd)/server/internal/store/migrations"
file="$dir/$(date -u +%Y%m%d%H%M%S)_${slug}.sql"
cat > "$file" <<'TEMPLATE'
-- +goose Up
-- WHY this migration exists, and what the release before it still reads.
--
-- Expand/contract (ADR-0019): a release only ADDS — nullable columns, new
-- tables, new indexes. Dropping or renaming happens one release AFTER the
-- release whose code stopped using the thing.

-- +goose Down
TEMPLATE
echo "$file"
