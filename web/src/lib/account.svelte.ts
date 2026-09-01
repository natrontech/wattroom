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

export interface Me {
	id: string;
	displayName: string;
	avatarUrl?: string;
	/** Picked preset id (#253); absent = OAuth photo, then initial. */
	avatarPreset?: string;
	/** Lifetime XP — level and ring derive from it (docs/SPEC.md). */
	totalXp?: number;
	ftpWatts: number;
	weightKg: number;
	/** Filled when the 90-day curve outgrows the setting (#26). */
	suggestedFtp?: number;
	best20m?: number;
	providers?: string[];
	/** LiveKit is configured — voice/camera affordances render at all (#219). */
	avEnabled?: boolean;
	stravaUpload?: boolean;
	/** Email notifications for planned sessions (#117); the section hides
	 * entirely when the server cannot send (mailAvailable absent). */
	email?: string | null;
	notifyPlanned?: boolean;
	mailAvailable?: boolean;
	/** Appearance follows the account (#326): the palette choice JSON ("" =
	 * the default) and the scheme ("" = auto); null = never chosen anywhere. */
	accentPalette?: string | null;
	colorScheme?: string | null;
}

function createAccountStore() {
	let me = $state<Me | null>(null);
	let providers = $state<string[]>([]);
	let loaded = $state(false);

	async function load(): Promise<void> {
		try {
			const [meRes, provRes] = await Promise.all([
				api<Me>('/api/me'),
				api<{ providers?: string[] }>('/api/auth/providers'),
			]);
			me = meRes.ok ? meRes.data : null;
			// Any failure (404 = server running without a database) stays hidden.
			providers = provRes.ok ? (provRes.data.providers ?? []) : [];
		} finally {
			loaded = true;
		}
	}

	return {
		get me() {
			return me;
		},
		get providers() {
			return providers;
		},
		get loaded() {
			return loaded;
		},
		load,
		/** Returns a field-keyed error message, or null on success. */
		async save(next: {
			displayName: string;
			ftpWatts: number;
			weightKg: number;
			stravaUpload?: boolean;
			email?: string;
			notifyPlanned?: boolean;
			/** "" clears the pick (back to the photo); absent keeps it. */
			avatarPreset?: string;
		}): Promise<{ message: string; field?: string } | null> {
			const res = await api<Me>('/api/me', { method: 'PATCH', json: next });
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
