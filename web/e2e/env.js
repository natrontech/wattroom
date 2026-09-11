// Which ports and which database the e2e harness takes, from the one place
// that decides that for this repository: scripts/dev-env.sh.
//
// It used to be two literals here — :4173 and :8081 — plus the canonical
// `wattroom` database, which made a full `pnpm run test:e2e` unrunnable
// anywhere but the main working tree. Several agents drive this clone at once
// (AGENTS.md); a second run bound nothing, drove the first run's server, and
// wrote its rooms and rides into the database the first one was asserting
// about. The symptom is nineteen failures in specs the branch never touched,
// every one of them green on its own and green in CI.
//
// Derived rather than re-implemented: the shell script already hashes the
// worktree's absolute path, and two derivations of one offset would drift.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
	new URL('../../scripts/dev-env.sh', import.meta.url),
);

// PLAYWRIGHT_BASE_URL aims the suite at a deployed target. That run starts no
// server — playwright.config.ts leaves `webServer` undefined — so it needs no
// port and no database, and must not need scripts/dev-env.sh either.
//
// Everything below is therefore derived on demand rather than at import. Doing
// it eagerly made the production release gate depend on a file outside its own
// mount: the synthetic ride's container mounts web/ alone, so `../../` left the
// mount, `sh` could not open the script, and Playwright died loading its
// config. The ride never rode, the gate read that as a failed ride, and a
// healthy 2026.09.113 was rolled back and blacklisted for it (#2126).
//
// Empty counts as unset, matching the falsy check in playwright.config.ts that
// this absorbs: an exported but blank variable means "no deployed target", not
// a target named "".
const external = process.env.PLAYWRIGHT_BASE_URL || undefined;

let cache;
function devEnv() {
	if (cache) return cache;
	cache = {};
	for (const line of execFileSync('sh', [script, 'print'], {
		encoding: 'utf8',
	}).split('\n')) {
		const match = /^export ([A-Z_0-9]+)='(.*)'$/.exec(line);
		if (match) cache[match[1]] = match[2];
	}
	return cache;
}

// A missing number is fatal, never a default: `server.listen(NaN)` binds a
// random free port quite happily, and then Playwright's readiness probe waits
// two minutes on the port it was told about and reports a server that never
// started.
function port(name) {
	const raw = devEnv()[name];
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(
			`${script} print gave no usable ${name} (got ${JSON.stringify(raw)})`,
		);
	}
	return value;
}

export const webPort = () => port('WATTROOM_E2E_WEB_PORT');
export const apiPort = () => port('WATTROOM_E2E_API_PORT');

// The deployed target when there is one, this checkout's own web server
// otherwise. Asking for it is what decides whether anything gets derived.
export const baseUrl = () => external ?? `http://localhost:${webPort()}`;

// Whether the suite is riding something already deployed — playwright.config.ts
// builds and serves locally only when it is not.
export const isExternal = () => external !== undefined;

// This checkout's dev database. The e2e run signs in through the login gate
// and writes real rooms and rides, so it wants a database that is migrated and
// disposable — the same one `make dev-server` and the verify server use, never
// the main tree's `wattroom` unless this IS the main tree. WATTROOM_DB set by
// the caller wins: CI names its own service container.
export const dbDsn = () => process.env.WATTROOM_DB ?? devEnv().WATTROOM_DEV_DSN;

// ensureDatabase creates it if this is a worktree that has not run
// `make dev-server` yet; in the main tree, and whenever the caller brought
// their own WATTROOM_DB, it is a no-op that never reaches Docker.
export function ensureDatabase() {
	if (process.env.WATTROOM_DB) return;
	execFileSync('sh', [script, 'ensure-db'], { stdio: 'inherit' });
}
