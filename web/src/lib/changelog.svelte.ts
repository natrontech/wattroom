/**
 * What's new (#345). The changelog ships as a static asset of the same build
 * as the binary, so it always describes the version actually running.
 *
 * The announcement rules exist so this never becomes an annoyance:
 * - silent on a first visit — nobody upgraded, so there is nothing to announce
 * - silent on "dev" builds, which are not releases (ADR-0019)
 * - silent when the running version has no changelog section
 * The caller decides *where* it appears; ux.md decides it is never mid-ride.
 *
 * Several releases can land between two visits (#631). The newest is announced
 * in full; the rest are counted, and their actions still apply — otherwise
 * whatever a missed release offered is never offered at all.
 */
import { api } from './api';
import {
	actionsFor,
	parseChangelog,
	releasedOnly,
	releaseToAnnounce,
	skippedReleases,
	type Release,
} from './changelog';
import { RELEASE_ACTIONS, type ReleaseAction } from './release-actions';

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
let skipped = $state<Release[]>([]);
let actions = $state<ReleaseAction[]>([]);
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
	/** Releases that landed between the announced one and the rider's last visit. */
	get skipped() {
		return skipped;
	},
	/** One-tap offers from the announced release and the skipped ones. */
	get actions() {
		return actions;
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
			skipped = skippedReleases(version, seen, releases);
			// Availability is read once, here. A rider already on the theme an
			// action offers never sees that button; one who taps it keeps it,
			// disabled, instead of watching it vanish under their finger.
			actions = unseen
				? actionsFor(unseen, skipped, RELEASE_ACTIONS).filter((a) =>
						a.available(),
					)
				: [];
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
		skipped = [];
		actions = [];
	},
};
