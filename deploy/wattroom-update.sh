#!/bin/bash
# Converge this VM onto the newest published release (ADR-0019).
#
# The target is the highest CalVer tag in the registry the VM already pulls
# from — no second credential, nothing to keep in sync by hand. Set
# WATTROOM_PIN in .env to hold a specific release instead; that is how a
# deliberate rollback sticks, and it is what a failed deploy sets for you.
#
# It refuses to interrupt a ride, dumps the database first, and retags to the
# previous release if the new one does not report itself healthy. It never
# restores a dump: that would discard every ride recorded since, which is worse
# than the bug being rolled back from, and is not a decision a five-minute
# timer makes at 3am. Automated recovery stops at the image tag.
#
# systemd runs this as a oneshot, so two firings cannot overlap and no lock is
# needed. Config lives in wattroom-update.env (EnvironmentFile in the unit).
set -euo pipefail

STACK_DIR=${STACK_DIR:-/opt/wattroom}
IMAGE_REPO=${IMAGE_REPO:-natrontech/wattroom}
REGISTRY=${REGISTRY:-ghcr.io}
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

env_get() { awk -F= -v k="$1" '$1 == k {print $2; exit}' "$STACK_DIR/.env"; }

env_set() {
	local key=$1 value=$2 tmp
	tmp=$(mktemp "$STACK_DIR/.env.XXXXXX") || die "cannot write beside $STACK_DIR/.env"
	# Rewrite in place if present, append if not; through a temp file because a
	# half-written .env takes the stack down on the next `up -d`.
	if ! {
		awk -F= -v k="$key" -v v="$value" '
			$1 == k { print k "=" v; found = 1; next }
			{ print }
			END { if (!found) print k "=" v }
		' "$STACK_DIR/.env" >"$tmp" && mv "$tmp" "$STACK_DIR/.env"
	}; then
		rm -f "$tmp"
		die "could not update $key in $STACK_DIR/.env"
	fi
}

# The app answers on the loopback port the compose stack publishes. A deploy
# gate's question is "is the binary I just started serving?", not "is DNS and
# TLS up", and /metrics has no route through Caddy on purpose.
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

# --- what the registry has --------------------------------------------------

# Reuse the credential docker already logged in with, so switching this on adds
# no secret. A credential *helper* stores nothing here, hence the env fallback.
registry_auth() {
	if [ -n "${GHCR_USER:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
		printf '%s' "$(printf '%s:%s' "$GHCR_USER" "$GHCR_TOKEN" | base64 | tr -d '\n')"
		return 0
	fi
	local auth
	auth=$(sed -n "/\"$REGISTRY\"/,/}/s/.*\"auth\": *\"\([^\"]*\)\".*/\1/p" \
		"${DOCKER_CONFIG:-$HOME/.docker}/config.json" 2>/dev/null | head -1)
	[ -n "$auth" ] || return 1
	printf '%s' "$auth"
}

newest_release() {
	local auth token tags
	auth=$(registry_auth) || die "no $REGISTRY credential — run 'docker login $REGISTRY', or set GHCR_USER and GHCR_TOKEN in /etc/wattroom-update.env"
	token=$(curl -sf --max-time 10 -H "Authorization: Basic $auth" \
		"https://$REGISTRY/token?scope=repository:$IMAGE_REPO:pull&service=$REGISTRY" |
		sed -n 's/.*"token":"\([^"]*\)".*/\1/p') ||
		die "cannot get a pull token from $REGISTRY"
	[ -n "$token" ] || die "$REGISTRY returned no pull token — is the credential still valid?"
	tags=$(curl -sf --max-time 10 -H "Authorization: Bearer $token" \
		"https://$REGISTRY/v2/$IMAGE_REPO/tags/list?n=1000") ||
		die "cannot list tags for $IMAGE_REPO"
	# CalVer only: :main and :<sha> are built too and are not releases.
	printf '%s' "$tags" |
		grep -o '"[0-9]\{4\}\.[0-9]\{2\}\.[0-9]\{1,\}"' | tr -d '"' |
		sort -t. -k1,1n -k2,2n -k3,3n | tail -1
}

held=$(env_get WATTROOM_PIN)
if [ -n "$held" ]; then
	# A hold is deliberate: a rollback someone chose, or one this script had to
	# make. Tracking stays off until the line is cleared.
	want=$held
else
	want=$(newest_release)
	[ -n "$want" ] || die "no release tags found in $REGISTRY/$IMAGE_REPO"
fi

printf '%s' "$want" | grep -Eq '^[0-9]{4}\.(0[1-9]|1[0-2])\.[0-9]+$' ||
	die "not a CalVer release tag: '$want'"

# What is actually serving is the truth about "current"; .env is only what
# compose will use next. Asking the container first means a run killed between
# a successful deploy and the .env write does not redeploy the same release on
# every tick — which would dump the database every five minutes forever.
have=$(running_version || true)
if [ -z "$have" ] || [ "$have" = dev ]; then
	have=$(env_get WATTROOM_TAG)
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
		# Hold here. Without this the timer finds the same newest tag in five
		# minutes and redeploys the broken release, dumping the database each
		# time, forever. Clearing WATTROOM_PIN is how tracking resumes.
		env_set WATTROOM_PIN "$have"
		die "$want failed its health gate; rolled back to $have and held there (clear WATTROOM_PIN in $STACK_DIR/.env to resume tracking)"
	fi
	sleep 3
done

env_set WATTROOM_TAG "$want"
notify "wattroom-update: deployed $want (was $have), dump at $dump"
