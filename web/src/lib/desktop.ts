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
import { api } from '$lib/api';

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

const RELEASES_REPO = 'natrontech/wattroom-releases';
const FEED = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
const TAG_PREFIX = 'desktop-v';

/** The shell's version when this page runs inside it, else null. */
export function shellVersion(): string | null {
	const shell = (globalThis as { wattroom?: { version?: unknown } }).wattroom;
	return typeof shell?.version === 'string' ? shell.version : null;
}

/**
 * The shell's self-update bridge (#1303), or null in a browser and in a
 * shell older than desktop-v2026.9.5 — which still needs the download link.
 *
 * `onUpdate` fires with the release the shell has already downloaded — now
 * if one is waiting, and later as they land.
 */
export interface ShellUpdate {
	onUpdate: (cb: (u: { version: string }) => void) => void;
	installUpdate: () => void;
}

export function shellUpdate(): ShellUpdate | null {
	const shell = (globalThis as { wattroom?: Partial<ShellUpdate> }).wattroom;
	return typeof shell?.onUpdate === 'function' &&
		typeof shell.installUpdate === 'function'
		? (shell as ShellUpdate)
		: null;
}

/** Whether that bridge is there, for a page that only needs the answer. */
export function shellSelfUpdates(): boolean {
	return shellUpdate() !== null;
}

/**
 * Whether the shell's updater has given up for now (#1940) — three failed
 * checks in a row — so the page offers the download instead of waiting for
 * a self-update that is not coming. False in a browser and in an older shell.
 */
export async function shellUpdateFailed(): Promise<boolean> {
	const shell = (
		globalThis as { wattroom?: { updateFailed?: () => Promise<unknown> } }
	).wattroom;
	if (typeof shell?.updateFailed !== 'function') return false;
	try {
		return (await shell.updateFailed()) === true;
	} catch {
		return false;
	}
}

/**
 * The sign-in hand-off (#1941): the shell hands the token from
 * wattroom://auth/<token> to the page instead of loading /login over it, so
 * the app decides — redeem on /login, or say it is already signed in.
 */
export function onShellHandoff(cb: (token: string) => void): void {
	const shell = (
		globalThis as {
			wattroom?: { onHandoff?: (cb: (t: string) => void) => void };
		}
	).wattroom;
	shell?.onHandoff?.((token) => {
		if (typeof token === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(token))
			cb(token);
	});
}

/**
 * The height of the strip the app draws where the shell hid the OS title bar
 * (#1188), or 0 in a browser and in a shell old enough to keep its own bar.
 */
export function shellTitleBar(): number {
	const shell = (globalThis as { wattroom?: { titleBar?: unknown } }).wattroom;
	const h = shell?.titleBar;
	return typeof h === 'number' && h > 0 ? h : 0;
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

// ── Signing in from the shell (#1188, ADR-0040) ──────────────────────────
//
// The shell cannot sign a rider in (no WebAuthn UI; Google refuses OAuth from
// Electron), so it sends them to the ordinary login page in the system
// browser with a nonce, and the browser comes back through wattroom://auth.
// The nonce lives in localStorage rather than sessionStorage: on Windows and
// Linux the link can arrive as a cold start, and a fresh window has no
// session storage to remember anything with.

const NONCE_KEY = 'wattroom.desktop-signin.v1';
const NONCE_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/** The login page the browser opens: our own origin, the nonce in the query. */
export function browserSignInUrl(origin: string, nonce: string): string {
	return `${origin}/login?desktop=${encodeURIComponent(nonce)}`;
}

/** A fresh nonce, remembered until the handoff redeems it. */
export function startBrowserSignIn(): string {
	const nonce = crypto.randomUUID().replace(/-/g, '');
	try {
		localStorage.setItem(NONCE_KEY, nonce);
	} catch {
		/* no storage: the redeem fails closed, and the page says to try again */
	}
	return nonce;
}

/** The nonce from a `?desktop=` query, only if it looks like one we made. */
export function desktopNonce(search: URLSearchParams): string | null {
	const n = search.get('desktop');
	return n && NONCE_SHAPE.test(n) ? n : null;
}

/** In the browser, once signed in: a one-time token → the link back to the app. */
export async function handoffLink(nonce: string): Promise<string | null> {
	const res = await api<{ token: string }>('/api/auth/desktop/handoff', {
		method: 'POST',
		json: { nonce },
	});
	return res.ok ? `wattroom://auth/${res.data.token}` : null;
}

/**
 * In the shell, arriving on `/login?handoff=<token>`: redeem it with the
 * nonce this window kept. A message when it did not work, null when it did —
 * the session cookie is then set and `account.load()` finds it.
 */
export async function redeemHandoff(token: string): Promise<string | null> {
	let nonce: string | null = null;
	try {
		nonce = localStorage.getItem(NONCE_KEY);
	} catch {
		/* handled below */
	}
	if (!nonce) {
		return 'This sign-in was started somewhere else. Start again from this app.';
	}
	const res = await api<unknown>('/api/auth/desktop/redeem', {
		method: 'POST',
		json: { token, nonce },
	});
	try {
		localStorage.removeItem(NONCE_KEY);
	} catch {
		/* fine */
	}
	return res.ok ? null : res.error.message;
}
