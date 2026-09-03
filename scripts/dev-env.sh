#!/bin/sh
# Per-worktree dev runtime: which ports and which database this checkout takes.
#
# Several agents drive this repository at once, each from its own git worktree
# (AGENTS.md). They used to share one pair of dev ports and one database, so the
# second `make dev-server` either failed to bind or — worse — the second agent
# drove the first agent's server and reported on somebody else's code (#552).
#
# The main working tree keeps the historical values (:8080, :5174, `wattroom`)
# so nothing a human or a script already knows changes. Every linked worktree
# derives its own pair and its own database from a CRC of its absolute path:
# stable across runs, different between checkouts, and needing no registry to
# hand ports out.
#
# Usage:
#   dev-env.sh print       eval-able `export KEY=value` lines
#   dev-env.sh banner NAME the one loud line `make dev-<name>` prints first
#   dev-env.sh ensure-db   create this worktree's database if it does not exist
#   dev-env.sh drop-db     drop it (never the main tree's `wattroom`)
set -eu

# Ports live above everything the repo already pins: :8080 and :8082 (server and
# the verify config), :5174 (Vite), :7880/:7881 (LiveKit), :4173/:8081 (e2e).
# One offset drives all three ports, so a worktree's Vite, dev server and verify
# server always pair up.
SERVER_PORT_BASE=8100
WEB_PORT_BASE=5300
VERIFY_PORT_BASE=8500
PORT_SPAN=200

PG_CONTAINER=${WATTROOM_PG_CONTAINER:-wattroom-postgres-1}
PG_USER=${WATTROOM_PG_USER:-wattroom}
PG_DSN_PREFIX=${WATTROOM_PG_DSN_PREFIX:-postgres://wattroom:wattroom@localhost:5432}

# crc32 of stdin — POSIX cksum, so the same number on Linux and macOS.
crc() { printf '%s' "$1" | cksum | awk '{print $1}'; }

toplevel=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# A linked worktree's own git dir sits under the main tree's; in the main tree
# the two are the same directory. That is the whole test.
is_main_tree=1
if git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null); then
	common_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd)
	[ "$git_dir" = "$common_dir" ] || is_main_tree=0
fi

if [ "$is_main_tree" = 1 ]; then
	worktree_name=main
	server_port=8080
	web_port=5174
	verify_port=8082
	db_name=wattroom
else
	worktree_name=$(basename "$toplevel")
	hash=$(crc "$toplevel")
	offset=$((hash % PORT_SPAN))
	server_port=$((SERVER_PORT_BASE + offset))
	web_port=$((WEB_PORT_BASE + offset))
	verify_port=$((VERIFY_PORT_BASE + offset))
	# Readable in `psql -l`, and the CRC suffix keeps two worktrees of the same
	# name at different paths apart. Postgres caps identifiers at 63 bytes.
	slug=$(printf '%s' "$worktree_name" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | cut -c1-32 | sed 's/_*$//')
	db_name=$(printf 'wattroom_wt_%s_%04x' "$slug" $((hash % 65536)))
fi

dsn="$PG_DSN_PREFIX/$db_name"

case ${1:-print} in
print)
	cat <<END
export WATTROOM_WORKTREE='$worktree_name'
export WATTROOM_DEV_SERVER_PORT='$server_port'
export WATTROOM_DEV_WEB_PORT='$web_port'
export WATTROOM_DEV_VERIFY_PORT='$verify_port'
export WATTROOM_DEV_DB_NAME='$db_name'
export WATTROOM_DEV_DSN='$dsn'
END
	;;
banner)
	what=${2:-dev}
	case $what in
	server) echo "dev-server [$worktree_name] → http://localhost:$server_port · db $db_name" ;;
	web) echo "dev-web [$worktree_name] → http://localhost:$web_port · api http://localhost:$server_port · db $db_name" ;;
	verify) echo "verify [$worktree_name] → http://localhost:$verify_port · db $db_name" ;;
	*) echo "$what [$worktree_name] → server :$server_port · web :$web_port · verify :$verify_port · db $db_name" ;;
	esac
	;;
ensure-db)
	# The main tree's database is compose's job (POSTGRES_DB); only a worktree
	# database is created here, on demand, because the server migrates at boot.
	if [ "$is_main_tree" = 1 ]; then
		exit 0
	fi
	if ! docker exec "$PG_CONTAINER" psql -U "$PG_USER" -tc "select 1 from pg_database where datname='$db_name'" 2>/dev/null | grep -q 1; then
		if docker exec "$PG_CONTAINER" createdb -U "$PG_USER" "$db_name" 2>/dev/null; then
			echo "created database $db_name"
		else
			echo "warning: could not create database $db_name in container $PG_CONTAINER — is \`make infra\` up?" >&2
		fi
	fi
	;;
drop-db)
	if [ "$is_main_tree" = 1 ]; then
		echo "refusing to drop the main tree's database ($db_name)" >&2
		exit 1
	fi
	docker exec "$PG_CONTAINER" dropdb -U "$PG_USER" --if-exists --force "$db_name" >/dev/null
	echo "dropped database $db_name"
	;;
*)
	echo "usage: dev-env.sh [print|banner <server|web>|ensure-db|drop-db]" >&2
	exit 2
	;;
esac
