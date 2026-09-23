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

async function check() {
	const res = await api<{ version?: string }>('/api/version');
	const version = res.ok ? res.data.version : undefined;
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
