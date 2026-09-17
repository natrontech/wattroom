#!/bin/sh
# Per-worktree dev runtime: which ports and which database this checkout takes.
#
# Several agents drive this repository at once, each from its own git worktree
# (AGENTS.md). They used to share one pair of dev ports and one database, so the
# second `make dev-server` either failed to bind or — worse — the second agent
# drove the first agent's server and reported on somebody else's code (#552).
#
# The main working tree keeps the historical values (:8080, :5174, `wattroom`,
# `wattroom_test`) so nothing a human or a script already knows changes. Every
# linked worktree derives its own ports and its own two databases from a CRC of
# its absolute path: stable across runs, different between checkouts, and
# needing no registry to hand ports out.
#
# Two databases, because they are opposites and always were. The dev one holds
# a seeded world worth keeping; the test one is destroyed by its own suite,
# which deletes users. `wattroom_test` was the one thing left shared after
# #552, and sharing it is a race: `go test` from two checkouts at once has each
# suite deleting the other's rows, so both go red locally while CI — one fresh
# database per job — stays green. On 2026-09-10 three agents hit that in one
# afternoon; `internal/playlists` and `internal/account` failed in two
# checkouts at once and passed in isolation from either.
#
# The Postgres server itself is the one thing no checkout owns — see PG_PROJECT
# below, and `make infra`, which is this script too.
#
# Usage:
#   dev-env.sh print       eval-able `export KEY=value` lines
#   dev-env.sh banner NAME the one loud line `make dev-<name>` prints first
#   dev-env.sh infra       start the shared Postgres + LiveKit project (`make infra`)
#   dev-env.sh ensure-db   create this worktree's dev database if it is missing
#   dev-env.sh ensure-test-db  same for its test database (`make test`)
#   dev-env.sh drop-db     drop both (never the main tree's `wattroom`)
#   dev-env.sh pg-container  the container id both of those act in
#   dev-env.sh pg-strays   report postgres containers outside the shared project
set -eu

# Ports live above everything the repo already pins: :8080 and :8082 (server and
# the verify config), :5174 (Vite), :7880/:7881 (LiveKit), :4173/:8081 (the e2e
# harness) — every one of those now the main working tree's own value, below —
# and clear of :5432 (Postgres). The Vite range used to start at 5300, which put
# 5432 inside it: the worktree hashing there had Vite quietly rebind to 5433
# while `make dev-env` kept advertising the database's port (#712).
# One offset drives every port, so a worktree's Vite, dev server, verify server
# and e2e harness always pair up.
#
# The e2e pair is here for the same reason as the rest: `web/e2e/server.js` used
# to hardcode :4173 and :8081, so a full `pnpm run test:e2e` from a worktree
# drove — or was driven by — whichever checkout had got there first. It reads as
# nineteen failures in specs the branch never touched, each of them green in
# isolation and green in CI.
SERVER_PORT_BASE=8100
WEB_PORT_BASE=5500
VERIFY_PORT_BASE=8500
E2E_API_PORT_BASE=8700
E2E_WEB_PORT_BASE=4400
# The metrics listener (#1738) takes an offset too: it defaults to :9091, and
# two dev servers on one machine would otherwise fight over it — the second
# one's listener refuses to bind and logs, every run, for as long as the
# neighbour is up.
METRICS_PORT_BASE=9300
PORT_SPAN=200

PG_USER=${WATTROOM_PG_USER:-wattroom}
PG_DSN_PREFIX=${WATTROOM_PG_DSN_PREFIX:-postgres://wattroom:wattroom@localhost:5432}

# Who owns the Postgres server: nobody's checkout. One fixed compose project,
# started by `make infra` wherever that runs from.
#
# Plain `docker compose up -d` names the project after the directory it runs
# in, which made the server's lifetime one worktree's. Both halves of that hurt:
# removing the worktree left its container running, and two running postgres
# containers made pg_container below refuse for *every* checkout on the machine
# (#2107) — while bringing the project down with its worktree was worse still,
# because the project that happened to be serving everybody took all of their
# databases with it, `wattroom_test` included (#2105).
#
# `wattroom` is the project name the main working tree already had, so the
# volume (`wattroom_pgdata`) and the container (`wattroom-postgres-1`) keep the
# data they have and every checkout converges on them. WATTROOM_COMPOSE_PROJECT
# is for a second clone on this machine that wants a server of its own.
PG_PROJECT=${WATTROOM_COMPOSE_PROJECT:-wattroom}

# crc32 of stdin — POSIX cksum, so the same number on Linux and macOS.
crc() { printf '%s' "$1" | cksum | awk '{print $1}'; }

toplevel=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# Which Postgres to talk to. The shared project answers by label, which is an
# answer and not a guess — the guess is what went wrong in #814, when a
# checkout assumed `wattroom-postgres-1` while a worktree's own project was
# serving, and created its database nowhere. Pinning the project is what makes
# the name knowable again.
#
# The two fallbacks are for a server that came up before the project was
# pinned: this checkout's own compose project, then a lone postgres container
# by service label. Several of those is still ambiguous and still asks, but it
# is no longer the ordinary case, because nothing starts a project per checkout
# any more.
pg_container() {
	if [ -n "${WATTROOM_PG_CONTAINER:-}" ]; then
		echo "$WATTROOM_PG_CONTAINER"
		return 0
	fi
	cid=$(docker ps -q --filter "label=com.docker.compose.project=$PG_PROJECT" --filter label=com.docker.compose.service=postgres 2>/dev/null) || cid=''
	if [ "$(printf '%s' "$cid" | grep -c .)" = 1 ]; then
		echo "$cid"
		return 0
	fi
	cid=$(docker compose --project-directory "$toplevel" ps -q postgres 2>/dev/null) || cid=''
	if [ -n "$cid" ]; then
		echo "$cid"
		return 0
	fi
	cid=$(docker ps -q --filter label=com.docker.compose.service=postgres 2>/dev/null) || cid=''
	[ "$(printf '%s' "$cid" | grep -c .)" = 1 ] || return 1
	echo "$cid"
}

# Running postgres containers that are not the shared project's: a compose
# project started before it was pinned, one a `git worktree remove` left behind
# — or another clone of this repo on the same machine, which looks exactly the
# same from here. So they are named and never stopped, the same caution the
# stranded-database report in scripts/worktree-gc.sh takes.
foreign_pg_containers() {
	docker ps --filter label=com.docker.compose.service=postgres \
		--format '{{.Names}}	{{.Label "com.docker.compose.project"}}' 2>/dev/null |
		awk -F'\t' -v mine="$PG_PROJECT" '$2 != mine' || true
}

# One home for the wording, because `make infra` and `make worktree-gc` both
# print it — the second one because a worktree it has just removed is the most
# likely source of a stray.
report_foreign_pg() {
	strays=$(foreign_pg_containers)
	[ -n "$strays" ] || return 0
	echo "postgres containers running outside the shared '$PG_PROJECT' project:"
	printf '%s\n' "$strays" | awk -F'\t' '{printf "    %s (compose project %s)\n", $1, $2}'
	echo "    One of these holds :5432 if \`make infra\` cannot bind it, and any"
	echo "    two postgres containers made every checkout refuse before the"
	echo "    project was pinned (#2107). Nothing in this clone needs them — if"
	echo "    no other clone on this machine does either: docker rm -f <name>"
}

# no_postgres explains the one failure both database subcommands share.
no_postgres() {
	echo "dev-env.sh: no single postgres container to use — run \`make infra\` (in any checkout: it starts the shared '$PG_PROJECT' project), or set WATTROOM_PG_CONTAINER when several are running" >&2
	report_foreign_pg >&2
	exit 1
}

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
	e2e_web_port=4173
	e2e_api_port=8081
	# The server's own default (#1738), spelled out here so every port this
	# script hands out is one it names — the main tree's were the numbers a
	# reader could find in one place, and a missing one is an unbound variable
	# in CI rather than a wrong port.
	metrics_port=9091
	db_name=wattroom
	test_db_name=wattroom_test
else
	worktree_name=$(basename "$toplevel")
	hash=$(crc "$toplevel")
	offset=$((hash % PORT_SPAN))
	server_port=$((SERVER_PORT_BASE + offset))
	web_port=$((WEB_PORT_BASE + offset))
	verify_port=$((VERIFY_PORT_BASE + offset))
	e2e_web_port=$((E2E_WEB_PORT_BASE + offset))
	e2e_api_port=$((E2E_API_PORT_BASE + offset))
	metrics_port=$((METRICS_PORT_BASE + offset))
	# Readable in `psql -l`, and the CRC suffix keeps two worktrees of the same
	# name at different paths apart. Postgres caps identifiers at 63 bytes.
	slug=$(printf '%s' "$worktree_name" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | cut -c1-32 | sed 's/_*$//')
	db_name=$(printf 'wattroom_wt_%s_%04x' "$slug" $((hash % 65536)))
	# Same slug and CRC, so a worktree's two databases sit next to each other
	# in `psql -l` and one glance says which checkout owns both. 63-byte
	# identifier cap: 17 + 32 + 5 fits.
	test_db_name=$(printf 'wattroom_test_wt_%s_%04x' "$slug" $((hash % 65536)))
fi

dsn="$PG_DSN_PREFIX/$db_name"
test_dsn="$PG_DSN_PREFIX/$test_db_name"

# Checked, not trusted, exactly like the ports below: every name this script
# hands out for the destructive suite must be recognisable as one. `drop-db`
# and `ensure-test-db` both act on it, and the failure mode of getting this
# wrong is a `make test` that deletes a seeded dev world instead of its own
# scratch rows — silent, and unrecoverable.
case $test_db_name in
wattroom_test | wattroom_test_*) ;;
*)
	echo "dev-env.sh: refusing '$test_db_name' as a test database — the destructive suite's database must be named wattroom_test*" >&2
	exit 1
	;;
esac

# The arithmetic above is checked, not trusted: no port this script hands out
# may be the one the database answers on, or whoever follows `make dev-env`
# talks to Postgres and gets wire-protocol bytes back instead of a refusal.
pg_port=${PG_DSN_PREFIX##*:}
case $pg_port in *[!0-9]* | '') pg_port=5432 ;; esac
for port in "$server_port" "$web_port" "$verify_port" "$e2e_web_port" "$e2e_api_port" "$metrics_port"; do
	if [ "$port" = "$pg_port" ]; then
		echo "dev-env.sh: refusing to hand worktree '$worktree_name' port $port — that is Postgres ($PG_DSN_PREFIX); move the *_PORT_BASE ranges off it" >&2
		exit 1
	fi
done

# create_db is idempotent: the caller may run on every `make dev-server`.
# Failures are loud — a database that silently did not appear surfaces later as
# a boot error that reads like the wrong thing entirely (#814).
create_db() {
	if docker exec "$1" psql -U "$PG_USER" -tc "select 1 from pg_database where datname='$2'" 2>/dev/null | grep -q 1; then
		return 0
	fi
	if ! docker exec "$1" createdb -U "$PG_USER" "$2"; then
		echo "dev-env.sh: could not create database $2 in container $1" >&2
		exit 1
	fi
	echo "created database $2"
}

case ${1:-print} in
print)
	cat <<END
export WATTROOM_WORKTREE='$worktree_name'
export WATTROOM_DEV_SERVER_PORT='$server_port'
export WATTROOM_DEV_WEB_PORT='$web_port'
export WATTROOM_DEV_VERIFY_PORT='$verify_port'
export WATTROOM_E2E_WEB_PORT='$e2e_web_port'
export WATTROOM_E2E_API_PORT='$e2e_api_port'
export WATTROOM_DEV_METRICS_PORT='$metrics_port'
export WATTROOM_DEV_DB_NAME='$db_name'
export WATTROOM_DEV_DSN='$dsn'
export WATTROOM_DEV_TEST_DB_NAME='$test_db_name'
export WATTROOM_DEV_TEST_DSN='$test_dsn'
END
	;;
banner)
	what=${2:-dev}
	case $what in
	server) echo "dev-server [$worktree_name] → http://localhost:$server_port · db $db_name" ;;
	web) echo "dev-web [$worktree_name] → http://localhost:$web_port · api http://localhost:$server_port · db $db_name" ;;
	verify) echo "verify [$worktree_name] → http://localhost:$verify_port · db $db_name" ;;
	test) echo "test [$worktree_name] → db $test_db_name" ;;
	e2e) echo "e2e [$worktree_name] → http://localhost:$e2e_web_port · api :$e2e_api_port · db $db_name" ;;
	*) echo "$what [$worktree_name] → server :$server_port · web :$web_port · verify :$verify_port · e2e :$e2e_web_port · db $db_name · test db $test_db_name" ;;
	esac
	;;
infra)
	# `make infra` from anywhere, always the same project (PG_PROJECT above).
	# The strays go first, before compose speaks: if one of them holds :5432
	# this is the explanation for the bind failure that follows.
	report_foreign_pg
	docker compose --project-directory "$toplevel" -p "$PG_PROJECT" up -d
	;;
pg-strays)
	report_foreign_pg
	;;
ensure-db)
	# The main tree's database is compose's job (POSTGRES_DB); only a worktree
	# database is created here, on demand, because the server migrates at boot.
	if [ "$is_main_tree" = 1 ]; then
		exit 0
	fi
	container=$(pg_container) || no_postgres
	create_db "$container" "$db_name"
	;;
ensure-test-db)
	# The suite deletes users, so its database must never be a dev one — hence
	# a name of its own, per checkout, created here on demand because the
	# store migrates it on first Open. WATTROOM_TEST_DB already set means the
	# caller brought their own Postgres (CI's service container does) and
	# `make test` passes that through untouched; nothing to create.
	if [ -n "${WATTROOM_TEST_DB:-}" ]; then
		exit 0
	fi
	container=$(pg_container) || no_postgres
	create_db "$container" "$test_db_name"
	;;
pg-container)
	# The gc needs the same answer for its stranded-database report, and this
	# is the only place that knows how to find it.
	pg_container || no_postgres
	;;
drop-db)
	# Both of this checkout's databases: `git worktree remove` runs no hook, so
	# whatever this does not take is litter in `psql -l` forever (AGENTS.md).
	if [ "$is_main_tree" = 1 ]; then
		echo "refusing to drop the main tree's databases ($db_name, $test_db_name)" >&2
		exit 1
	fi
	container=$(pg_container) || no_postgres
	for victim in "$db_name" "$test_db_name"; do
		docker exec "$container" dropdb -U "$PG_USER" --if-exists --force "$victim" >/dev/null
		echo "dropped database $victim"
	done
	;;
*)
	echo "usage: dev-env.sh [print|banner <server|web|verify|test|e2e>|infra|ensure-db|ensure-test-db|drop-db|pg-container|pg-strays]" >&2
	exit 2
	;;
esac
