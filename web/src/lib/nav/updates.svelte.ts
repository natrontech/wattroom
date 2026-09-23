import { changelog } from '$lib/changelog.svelte';
import {
	isNewer,
	latestRelease,
	shellSelfUpdates,
	shellUpdate,
	shellUpdateFailed,
	shellVersion,
	type ShellUpdate,
} from '$lib/desktop';
import { versionWatch } from '$lib/version-watch.svelte';
import { updateRowState } from './update-row';

/**
 * Everything the sidebar's update row reads, and what it does (#2588): the
 * shell's downloaded update, a newer desktop build it cannot fetch itself
 * (home's panel until now, #296), a newer WattRoom deployed under this
 * window, and a release not read yet. `updateRowState` picks the one to say.
 */
const SKIPPED = 'wattroom.desktop-skipped.v1';

let downloaded = $state<string | null>(null);
let installing = $state(false);
let manual = $state<string | null>(null);
let sheet = $state(false);
let bridge: ShellUpdate | null = null;
let started = false;

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* no storage: the row returns next load, the safe direction */
	}
}

/** A shell too old to update itself, or whose updater failed: the download. */
async function checkManual() {
	const running = shellVersion();
	if (!running) return;
	if (shellSelfUpdates() && !(await shellUpdateFailed())) return;
	const latest = await latestRelease();
	if (
		latest &&
		isNewer(latest.version, running) &&
		read(SKIPPED) !== latest.version
	)
		manual = latest.version;
}

export const updates = {
	get state() {
		const unseen = changelog.unseen;
		return updateRowState({
			installing,
			downloaded,
			manual,
			live: versionWatch.newer,
			unseen: unseen
				? {
						version: unseen.version,
						changes: unseen.sections.reduce((n, s) => n + s.items.length, 0),
					}
				: null,
		});
	},
	/** Idempotent; the sidebar starts it. */
	start(shell: ShellUpdate | null = shellUpdate()) {
		if (started) return;
		started = true;
		bridge = shell;
		// onUpdate replays a download that finished before this ran.
		bridge?.onUpdate((u) => (downloaded = u.version));
		void changelog.load();
		versionWatch.start();
		void checkManual();
	},
	install() {
		installing = true;
		bridge?.installUpdate();
	},
	/** "Not now" on a download by hand: that version stays away for good. */
	skipManual() {
		if (manual) write(SKIPPED, manual);
		manual = null;
	},
	reload() {
		location.reload();
	},
	get sheetOpen() {
		return sheet;
	},
	openSheet() {
		sheet = true;
	},
	closeSheet() {
		sheet = false;
	},
};
