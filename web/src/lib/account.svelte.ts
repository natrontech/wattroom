/**
 * The signed-in account, when there is one (#16).
 *
 * Coexists with the localStorage profile rather than replacing it: signed out
 * (or on a server with no OAuth configured — every dev env today) the app works
 * exactly as before. The localStorage profile stays the source the ride screens
 * read; signing in syncs the server copy into it, so nothing ride-side needs to
 * know accounts exist.
 */
import { api } from '$lib/api';
import { people } from '$lib/people.svelte';

export interface Me {
	id: string;
	displayName: string;
	/** The sign-in photo until the rider uploads one (#1353); then the
	 * server's own address, versioned so a replaced picture refetches. */
	avatarUrl?: string;
	/** Lifetime XP — level and ring derive from it (docs/SPEC.md). */
	totalXp?: number;
	ftpWatts: number;
	weightKg: number;
	/** The HR anchor (ADR-0014), on the account since #1571. */
	lthr?: number;
	/** Filled when the 90-day curve outgrows the setting (#26). */
	suggestedFtp?: number;
	best20m?: number;
	providers?: string[];
	/** LiveKit is configured — voice/camera affordances render at all (#219). */
	avEnabled?: boolean;
	/** Giphy is configured — the composer's GIF button renders at all (#878). */
	gifsEnabled?: boolean;
	stravaUpload?: boolean;
	/** Email notifications for planned sessions (#117); the section hides
	 * entirely when the server cannot send (mailAvailable absent). */
	email?: string | null;
	notifyPlanned?: boolean;
	mailAvailable?: boolean;
	/** The address as a recovery attribute (#781, ADR-0029). `emailVerified`
	 * is the only one that means "this rider can be reached"; `emailPending`
	 * is an address waiting on its link; `emailRequired` marks an account
	 * onboarded with the requirement. */
	emailVerified?: boolean;
	emailPending?: string | null;
	emailRequired?: boolean;
	/** Appearance follows the account (#326): the palette choice JSON ("" =
	 * the default) and the scheme ("" = auto); null = never chosen anywhere. */
	accentPalette?: string | null;
	colorScheme?: string | null;
	/** The IANA zone last reported from a browser (#858). Session email is
	 * written in it; absent, the server falls back to its own. */
	timezone?: string | null;
}

function createAccountStore() {
	let me = $state<Me | null>(null);
	let providers = $state<string[]>([]);
	// Whether a new account meets the address gate (ADR-0029) — said on the
	// sign-in page, before the gate is the first screen after it.
	let mailAvailable = $state(false);
	let loaded = $state(false);
	// The last providers read failed to reach the server at all — a first
	// load on a restarting server used to read as "no providers configured"
	// (audit 2026-09-09).
	let unreachable = $state(false);

	/**
	 * Which load is the current question. Home, the room layout, the landing
	 * page and the verify-email gate all call `load()`, the last of them on
	 * every `visibilitychange`, so a rider clicking around has several in
	 * flight at once and a slow one used to be able to answer last (#850).
	 */
	let asked = 0;

	async function load(): Promise<void> {
		const mine = ++asked;
		try {
			const [meRes, provRes] = await Promise.all([
				api<Me>('/api/me'),
				api<{ providers?: string[]; mailAvailable?: boolean }>(
					'/api/auth/providers',
				),
			]);
			if (mine !== asked) return;
			if (meRes.ok) {
				me = meRes.data;
				people.learn([{ ...me, name: me.displayName }]);
				void reportTimezone(meRes.data);
			} else if (meRes.error.error === 'unauthorized') {
				// The ONE answer that means signed out. A server that cannot be
				// reached, or a 500 from a session lookup that hit a database
				// blip, is a question that failed — not an answer about who this
				// is — and nulling `me` on one signed the rider out and took the
				// room, the voice channel and the trainer with it (#850).
				me = null;
			}
			// Any failure (404 = server running without a database) stays hidden;
			// an unreachable server keeps whatever we were last told.
			if (provRes.ok) {
				providers = provRes.data.providers ?? [];
				mailAvailable = provRes.data.mailAvailable ?? false;
				unreachable = false;
			} else if (provRes.error.error === 'network') {
				unreachable = true;
			} else {
				providers = [];
				unreachable = false;
			}
		} finally {
			if (mine === asked) loaded = true;
		}
	}

	/**
	 * Tell the server where this rider is, so a session email names a time
	 * they recognise instead of the one on the server's clock (#858).
	 *
	 * Reported, never asked: the browser already knows, and a timezone picker
	 * would fail the 95% rule in .claude/rules/ux.md. Reporting on every load
	 * is also what makes it right after a rider moves. Fire-and-forget — a
	 * failed write costs a slightly wrong time in an email, not this page.
	 */
	async function reportTimezone(current: Me): Promise<void> {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!zone || zone === current.timezone) return;
		const res = await api('/api/me/timezone', {
			method: 'PUT',
			json: { timezone: zone },
		});
		// load() runs on every visibilitychange, so remember it here too
		// rather than waiting for the next GET to echo it back.
		if (res.ok && me) me.timezone = zone;
	}

	return {
		get me() {
			return me;
		},
		get mailAvailable() {
			return mailAvailable;
		},
		get providers() {
			return providers;
		},
		get loaded() {
			return loaded;
		},
		get unreachable() {
			return unreachable;
		},
		load,
		/** Returns a field-keyed error message, or null on success. */
		async save(next: {
			displayName: string;
			ftpWatts: number;
			weightKg: number;
			/** Absent keeps the anchor; 0 clears it (#1571). */
			lthr?: number;
			stravaUpload?: boolean;
			email?: string;
			notifyPlanned?: boolean;
		}): Promise<{ message: string; field?: string } | null> {
			const res = await api<Me>('/api/me', { method: 'PATCH', json: next });
			if (res.ok) {
				me = res.data;
				return null;
			}
			return res.error;
		},
		/** The rider's own picture (#1353) — the same reader as a pasted image. */
		async setAvatar(image: Blob): Promise<{ message: string } | null> {
			const res = await api<Me>('/api/me/avatar', {
				method: 'POST',
				body: image,
				headers: { 'content-type': image.type },
			});
			if (res.ok) {
				me = res.data;
				return null;
			}
			return res.error;
		},
		async signOut(): Promise<void> {
			await api('/api/auth/logout', { method: 'POST' });
			me = null;
		},
	};
}

export const account = createAccountStore();
