import { api } from './api';

/**
 * Whether a newer WattRoom is live than the one this window runs (#2588).
 * The app ships inside the server's binary, so the version this window
 * loaded with is the server's first answer; a deploy changes the answer and
 * nothing else tells an open window — the desktop app stays open for days.
 *
 * ponytail: re-asked when the window comes back and every five minutes, not
 * pushed. The lobby socket reconnecting after a deploy is the exact moment,
 * if a deploy ever needs to be noticed sooner than that.
 */
const EVERY_MS = 5 * 60_000;

let loaded: string | null = null;
let newer = $state<string | null>(null);
let started = false;

async function ask(): Promise<string | undefined> {
	const res = await api<{ version?: string }>('/api/version');
	// ?. guards an older server answering with the SPA fallback.
	return res.ok ? res.data?.version : undefined;
}

let first: Promise<string | undefined> | null = null;
/**
 * The version this window loaded with: the server's first answer, asked once
 * for the watch and for What's new alike (#4565). A failed ask is asked again.
 */
export function loadedVersion(): Promise<string | undefined> {
	return (first ??= ask().then((version) => {
		if (!version) first = null;
		return version;
	}));
}

async function check() {
	const version = await (loaded === null ? loadedVersion() : ask());
	if (!version) return;
	if (loaded === null) loaded = version;
	else newer = version === loaded ? null : version;
}

export const versionWatch = {
	/** The version now live, when it is not the one this window loaded. */
	get newer() {
		return newer;
	},
	/** Idempotent; the sidebar starts it. */
	start() {
		if (started) return;
		started = true;
		void check();
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') void check();
		});
		setInterval(() => void check(), EVERY_MS);
	},
};
