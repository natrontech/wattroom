#!/bin/bash
# Switch on release tracking (ADR-0019). Run it on the VM, from a checkout of
# this repo's deploy/ directory:  sudo ./install-updater.sh
#
# It checks the things that fail quietly first, installs, then runs one
# convergence in the foreground so you see the result now rather than in the
# journal five minutes from now. Safe to re-run.
set -euo pipefail

STACK_DIR=${STACK_DIR:-/opt/wattroom}
export STACK_DIR # the updater reads it from the environment
UNITS=/etc/systemd/system
ENV_FILE=/etc/wattroom-update.env
here=$(cd "$(dirname "$0")" && pwd)

fail() {
	echo "✗ $1" >&2
	exit 1
}
ok() { echo "✓ $1"; }

# --- the things that fail quietly -------------------------------------------

[ -d "$STACK_DIR" ] || fail "$STACK_DIR does not exist — is the stack somewhere else? set STACK_DIR."
[ -f "$STACK_DIR/.env" ] || fail "$STACK_DIR/.env is missing"
ok "stack found at $STACK_DIR"

grep -q '^WATTROOM_TAG=' "$STACK_DIR/.env" ||
	fail "no WATTROOM_TAG in $STACK_DIR/.env — the compose file needs it and will refuse to start without it"
tag=$(awk -F= '/^WATTROOM_TAG=/{print $2; exit}' "$STACK_DIR/.env")
case "$tag" in
main | latest | '') fail "WATTROOM_TAG is '$tag' — pin it to a release (e.g. 2026.09.2) before tracking takes over" ;;
esac
ok "currently pinned to $tag"

# Tracking is off unless this line exists and is empty. Absent means the
# updater would read "" and track — same thing — but be explicit about it.
if ! grep -q '^WATTROOM_PIN=' "$STACK_DIR/.env"; then
	printf 'WATTROOM_PIN=\n' >>"$STACK_DIR/.env"
	ok "added WATTROOM_PIN= (empty: track the newest release)"
else
	held=$(awk -F= '/^WATTROOM_PIN=/{print $2; exit}' "$STACK_DIR/.env")
	[ -z "$held" ] && ok "WATTROOM_PIN is empty — tracking" ||
		echo "! WATTROOM_PIN=$held — held there; clear it to track the newest release"
fi

# The credential the updater reads. A credential *helper* stores nothing in
# config.json, which is the one setup that needs GHCR_USER/GHCR_TOKEN set.
if grep -q '"ghcr.io"' "${DOCKER_CONFIG:-$HOME/.docker}/config.json" 2>/dev/null &&
	grep -A2 '"ghcr.io"' "${DOCKER_CONFIG:-$HOME/.docker}/config.json" | grep -q '"auth"'; then
	ok "ghcr.io credential readable from docker config"
else
	echo "! no readable ghcr.io auth in docker config."
	echo "  Either run 'docker login ghcr.io', or set GHCR_USER and GHCR_TOKEN in $ENV_FILE"
	echo "  (a credential helper stores nothing this script can read)."
fi

docker compose -f "$STACK_DIR/docker-compose.prod.yml" config >/dev/null ||
	fail "the compose file does not validate — fix that before automating deploys of it"
ok "compose file validates"

# --- install ----------------------------------------------------------------

install -m 0755 "$here/wattroom-update.sh" "$STACK_DIR/wattroom-update.sh"
install -m 0644 "$here/wattroom-update.service" "$UNITS/wattroom-update.service"
install -m 0644 "$here/wattroom-update.timer" "$UNITS/wattroom-update.timer"
ok "script and units installed"

if [ -f "$ENV_FILE" ]; then
	ok "$ENV_FILE kept as it is"
else
	install -m 0644 "$here/wattroom-update.env.example" "$ENV_FILE"
	ok "$ENV_FILE created from the example — read it before the next tick"
fi

systemctl daemon-reload

# --- prove it works before trusting it to a timer ---------------------------

echo
echo "One convergence now, in the foreground:"
if NOTIFY_CMD='cat' bash "$STACK_DIR/wattroom-update.sh"; then
	ok "converged (silence above means it is already on the newest release)"
else
	fail "that run failed — read it above. Nothing is enabled; fix and re-run."
fi

systemctl enable --now wattroom-update.timer
echo
ok "timer enabled — next check within five minutes"
echo "  watch it:  journalctl -u wattroom-update -f"
echo "  hold a version:  set WATTROOM_PIN in $STACK_DIR/.env"
