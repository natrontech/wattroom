#!/bin/bash
# Converge this VM onto the release tag pinned in the homelab repo (ADR-0019).
#
# Reads the pin, refuses to interrupt a ride, dumps the database, rolls the
# image forward, and retags to the previous release if the new one does not
# report itself healthy. It never restores a dump: that would discard every
# ride recorded since the dump, which is worse than the bug being rolled back
# from, and is not a decision a five-minute timer makes at 3am. Automated
# recovery stops at the image tag; the dump is insurance for a human.
#
# systemd runs this as a oneshot, so two firings cannot overlap and no lock is
# needed. Config lives in wattroom-update.env (EnvironmentFile in the unit).
set -euo pipefail

STACK_DIR=${STACK_DIR:-/opt/wattroom}
PIN_REPO_DIR=${PIN_REPO_DIR:?set PIN_REPO_DIR — the homelab repo checkout on this VM}
PIN_FILE=${PIN_FILE:?set PIN_FILE — the file in that repo holding the tag, one line}
# Deploy events go to the journal unless the homelab points this somewhere that
# reaches a phone. A *broken production* is not this script's alerting job —
# Prometheus already watches that (WattroomDown, WattroomTicksSilentWithRiders).
NOTIFY_CMD=${NOTIFY_CMD:-logger -t wattroom-update}
GATE_TIMEOUT=${GATE_TIMEOUT:-90}
# Where the stack publishes the app on this host's loopback.
APP_URL=${APP_URL:-http://127.0.0.1:8080}

compose() { docker compose -f "$STACK_DIR/docker-compose.prod.yml" "$@"; }

notify() {
	# shellcheck disable=SC2086 # NOTIFY_CMD is a command with args, split on purpose
	printf '%s\n' "$1" | $NOTIFY_CMD
}

die() {
	notify "wattroom-update FAILED: $1"
	exit 1
}

# The app answers on the loopback port the compose stack publishes. A deploy
# gate's question is "is the binary I just started serving?", not "is DNS and
# TLS up", and /metrics has no route through Caddy on purpose — loopback is
# where the host can still ask. Reaching the container by its bridge IP would
# also have worked on Linux and nowhere else.
running_version() {
	curl -sf --max-time 3 "$APP_URL/api/version" |
		sed -n 's/.*"version":"\([^"]*\)".*/\1/p'
}

healthy() {
	[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$APP_URL/api/healthz")" = "200" ]
}

# Empty means "responding but the count could not be read" — see the caller.
riders() {
	local body
	# Read the body first: awk's early exit would SIGPIPE curl, and pipefail
	# would turn a healthy read into a failed one.
	body=$(curl -sf --max-time 3 "$APP_URL/metrics") || return 0
	printf '%s\n' "$body" | awk '/^wattroom_room_riders /{printf "%d", $2; exit}'
}

# --- what the repo wants -----------------------------------------------------

git -C "$PIN_REPO_DIR" pull --ff-only --quiet || die "cannot pull $PIN_REPO_DIR"
want=$(tr -d '[:space:]' <"$PIN_REPO_DIR/$PIN_FILE") || die "cannot read pin $PIN_FILE"

# The pin is an instruction from a file; it becomes an image tag and a path, so
# it is validated before it is either.
printf '%s' "$want" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' ||
	die "pin is not a release tag: '$want'"

# What is actually serving is the truth about "current"; .env is only what
# compose will use next. Asking the container first means a run killed between
# a successful deploy and the .env write does not redeploy the same release on
# every tick — which would dump the database every five minutes forever.
have=$(running_version || true)
if [ -z "$have" ] || [ "$have" = dev ]; then
	have=$(awk -F= '/^WATTROOM_TAG=/{print $2; exit}' "$STACK_DIR/.env") ||
		die "cannot read $STACK_DIR/.env"
fi
[ -n "$have" ] || die "cannot tell which release is running"
[ "$want" != "$have" ] || exit 0

# --- do not deploy into a ride ----------------------------------------------

# A server that answers is asked how many riders it has. Unreadable from a
# *responding* server counts as "riders present": a missed deploy costs five
# minutes, a deploy into a group ride costs the ride. A server that answers
# nothing has no riders to protect, and is the case a deploy most likely fixes.
if healthy; then
	n=$(riders || true)
	if [ -z "$n" ] || [ "$n" -gt 0 ]; then
		notify "holding $want: ${n:-unknown} rider(s) on the bike"
		exit 0
	fi
fi

# --- snapshot, then roll forward --------------------------------------------

mkdir -p "$STACK_DIR/backups"
dump="$STACK_DIR/backups/pre-$want-$(date +%F-%H%M%S).sql.gz"
compose exec -T postgres pg_dump -U wattroom wattroom | gzip >"$dump" || {
	rm -f "$dump" # a partial dump must not sit there looking restorable
	die "pg_dump before $want failed — nothing was deployed"
}

WATTROOM_TAG=$want compose pull -q wattroom || die "cannot pull image $want"
WATTROOM_TAG=$want compose up -d wattroom || die "compose up failed for $want"

deadline=$((SECONDS + GATE_TIMEOUT))
until [ "$(running_version || true)" = "$want" ] && healthy; do
	if [ "$SECONDS" -ge "$deadline" ]; then
		notify "wattroom-update: $want did not come up in ${GATE_TIMEOUT}s — rolling back to $have"
		WATTROOM_TAG=$have compose up -d wattroom ||
			die "ROLLBACK TO $have FAILED — production is down, $dump is the pre-deploy dump"
		rdeadline=$((SECONDS + GATE_TIMEOUT))
		until [ "$(running_version || true)" = "$have" ] && healthy; do
			[ "$SECONDS" -lt "$rdeadline" ] ||
				die "ROLLED BACK TO $have BUT IT IS NOT HEALTHY — production is down"
			sleep 3
		done
		# .env still names $have, so nothing has to be undone here.
		die "$want failed its health gate; rolled back to $have"
	fi
	sleep 3
done

# Only now is the tag persisted. A run killed before this point leaves .env
# naming the last release known to work, which is the direction to fail in.
# Written through a temp file: an .env truncated halfway would take the stack
# down on the next `up -d`, and `sed -i` is not the same command on every OS.
tmp=$(mktemp "$STACK_DIR/.env.XXXXXX") || die "cannot write beside $STACK_DIR/.env"
if ! { awk -v t="$want" '/^WATTROOM_TAG=/{print "WATTROOM_TAG=" t; next} {print}' \
	"$STACK_DIR/.env" >"$tmp" && mv "$tmp" "$STACK_DIR/.env"; }; then
	rm -f "$tmp"
	die "$want is deployed and healthy but .env still names $have — fix it by hand"
fi
notify "wattroom-update: deployed $want (was $have), dump at $dump"
