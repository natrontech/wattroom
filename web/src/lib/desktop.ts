/**
 * The desktop shell, seen from the web app (#296, ADR-0037).
 *
 * The shell is a window around this app and nothing more: it announces
 * itself as `window.wattroom`, and the app falls back to browser behaviour
 * without it. Its releases live in a public repo of their own, so GitHub
 * carries the download bandwidth and its `releases/latest` JSON is the one
 * feed both /download and the home page's update notice read.
 *
 * Read once per page load, never polled. Until the releases repo exists the
 * feed is a 404, and a 404 means "no build yet" — the page teaches, it does
 * not apologise (ux.md).
 */
export type OS = 'mac' | 'windows' | 'linux' | 'phone' | 'other';

export interface Installer {
	os: OS;
	name: string;
	url: string;
	bytes: number;
}

export interface DesktopRelease {
	/** `0.1.0` — the tag without its `desktop-v` prefix. */
	version: string;
	installers: Installer[];
	/** The release's own page: notes, and every platform. */
	page: string;
}

export const RELEASES_REPO = 'natrontech/wattroom-releases';
const FEED = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
const TAG_PREFIX = 'desktop-v';

/** The shell's version when this page runs inside it, else null. */
export function shellVersion(): string | null {
	const shell = (globalThis as { wattroom?: { version?: unknown } }).wattroom;
	return typeof shell?.version === 'string' ? shell.version : null;
}

/**
 * What the visitor is on. A phone gets no installer: WATTROOM.md makes it a
 * spectator in the browser. An iPad asking for a desktop site says
 * "Macintosh" and is offered the dmg — a wrong answer it can ignore, and not
 * worth a touch-points heuristic today.
 */
export function detectOS(userAgent: string): OS {
	if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return 'phone';
	if (/CrOS/.test(userAgent)) return 'other';
	if (/Mac OS X|Macintosh/.test(userAgent)) return 'mac';
	if (/Windows/.test(userAgent)) return 'windows';
	if (/Linux|X11/.test(userAgent)) return 'linux';
	return 'other';
}

/**
 * Which platform an installer is for, by extension. The release workflow
 * names them `WattRoom-<version>-<os>-<arch>.<ext>`; the name may change,
 * the extension cannot, so this is what the page keys on. electron-builder
 * also uploads `.blockmap` and `.yml` files beside them — those are nobody's.
 */
export function installerOS(name: string): OS | null {
	if (/\.dmg$/i.test(name)) return 'mac';
	if (/\.exe$/i.test(name)) return 'windows';
	if (/\.(AppImage|deb)$/i.test(name)) return 'linux';
	return null;
}

/** GitHub's release JSON → what the page needs. Null unless it is a desktop release. */
export function parseRelease(json: unknown): DesktopRelease | null {
	const r = json as {
		tag_name?: unknown;
		html_url?: unknown;
		assets?: unknown;
	} | null;
	if (typeof r?.tag_name !== 'string' || !r.tag_name.startsWith(TAG_PREFIX)) {
		return null;
	}
	const assets = Array.isArray(r.assets) ? r.assets : [];
	const installers: Installer[] = [];
	for (const a of assets as {
		name?: unknown;
		browser_download_url?: unknown;
		size?: unknown;
	}[]) {
		if (typeof a?.name !== 'string') continue;
		if (typeof a.browser_download_url !== 'string') continue;
		const os = installerOS(a.name);
		if (!os) continue;
		installers.push({
			os,
			name: a.name,
			url: a.browser_download_url,
			bytes: typeof a.size === 'number' ? a.size : 0,
		});
	}
	return {
		version: r.tag_name.slice(TAG_PREFIX.length),
		installers,
		page:
			typeof r.html_url === 'string'
				? r.html_url
				: `https://github.com/${RELEASES_REPO}/releases`,
	};
}

/**
 * `0.2.0` is newer than `0.1.9`: numbers, not strings. Anything that is not
 * plain numbers — a pre-release suffix, "dev" — is never newer, which keeps
 * the notice quiet rather than nagging.
 */
export function isNewer(candidate: string, running: string): boolean {
	const a = candidate.split('.').map(Number);
	const b = running.split('.').map(Number);
	if ([...a, ...b].some(Number.isNaN)) return false;
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}

/** `128377524` → `122 MB`: enough to know it is not a click on mobile data. */
export function formatBytes(bytes: number): string {
	if (bytes <= 0) return '';
	return `${Math.round(bytes / 1048576)} MB`;
}

let latest: Promise<DesktopRelease | null> | undefined;

/**
 * The newest desktop release, read once per page load. Null until one
 * exists — or until the feed answers, which a rate limit or an outage can
 * refuse; both read as "no build yet" until the next load, and that is the
 * safe direction for a page that hands out installers.
 */
export function latestRelease(): Promise<DesktopRelease | null> {
	latest ??= fetch(FEED, { headers: { Accept: 'application/vnd.github+json' } })
		.then((res) => (res.ok ? res.json() : null))
		.then((json) => (json ? parseRelease(json) : null))
		.catch(() => null);
	return latest;
}
