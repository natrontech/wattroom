/**
 * What's new (#345). The changelog ships as a static asset of the same build
 * as the binary, so it always describes the version actually running.
 *
 * The announcement rules exist so this never becomes an annoyance:
 * - silent on a first visit — nobody upgraded, so there is nothing to announce
 * - silent on "dev" builds, which are not releases (ADR-0019)
 * - silent when the running version has no changelog section
 * The caller decides *where* it appears; ux.md decides it is never mid-ride.
 */
import { api } from './api';
import {
	parseChangelog,
	releasedOnly,
	releaseToAnnounce,
	type Release,
} from './changelog';

const SEEN = 'wattroom.seen-version.v1';

function readSeen(): string | null {
	try {
		return localStorage.getItem(SEEN);
	} catch {
		return null; // no storage: stay quiet rather than announce every load
	}
}

function writeSeen(version: string) {
	try {
		localStorage.setItem(SEEN, version);
	} catch {
		/* fine — the notice may reappear next time, which is the safe direction */
	}
}

let releases = $state<Release[] | null>(null);
let failed = $state(false);
let version = $state<string | null>(null);
let unseen = $state<Release | null>(null);
let loading = false;

export const changelog = {
	/** Released versions, newest first. Null until loaded. */
	get releases() {
		return releases;
	},
	/** The running release, or null on a dev build. */
	get version() {
		return version;
	},
	/** The release to announce, if this load is the first to see it. */
	get unseen() {
		return unseen;
	},
	get failed() {
		return failed;
	},

	async load() {
		if (releases || loading) return;
		loading = true;
		try {
			const [running, text] = await Promise.all([
				api<{ version?: string }>('/api/version'),
				fetch('/changelog.md').then((r) => (r.ok ? r.text() : null)),
			]);
			if (text === null) {
				failed = true;
				return;
			}
			releases = releasedOnly(parseChangelog(text));
			// ?. guards an older server answering with the SPA fallback.
			const v = running.ok ? (running.data?.version ?? null) : null;
			version = v && v !== 'dev' ? v : null;
			const seen = readSeen();
			// A first visit records where the rider came in and says nothing.
			if (seen === null && version) writeSeen(version);
			unseen = releaseToAnnounce(version, seen, releases);
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	},

	/** Acknowledge the running version; the notice does not come back. */
	dismiss() {
		if (version) writeSeen(version);
		unseen = null;
	},
};
