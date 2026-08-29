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
	ftpWatts: number;
	weightKg: number;
	/** Filled when the 90-day curve outgrows the setting (#26). */
	suggestedFtp?: number;
}

function createAccountStore() {
	let me = $state<Me | null>(null);
	let providers = $state<string[]>([]);
	let loaded = $state(false);

	async function load(): Promise<void> {
		try {
			const [meRes, provRes] = await Promise.all([
				fetch('/api/me'),
				fetch('/api/auth/providers'),
			]);
			me = meRes.ok ? await meRes.json() : null;
			// 404 = server running without a database; both stay hidden.
			providers = provRes.ok ? ((await provRes.json()).providers ?? []) : [];
		} catch {
			me = null;
			providers = [];
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
		}): Promise<{ message: string; field?: string } | null> {
			const res = await api<Me>('/api/me', { method: 'PATCH', json: next });
			if (res.ok) {
				me = res.data;
				return null;
			}
			return res.error;
		},
		async signOut(): Promise<void> {
			await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
			me = null;
		},
	};
}

export const account = createAccountStore();
