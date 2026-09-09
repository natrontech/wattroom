import { account } from '$lib/account.svelte';
import { untrack } from 'svelte';
import type { createProfileStore } from '$lib/profile.svelte';

/**
 * The account is the truth for FTP and weight (everything is signed in,
 * ADR-0009); localStorage is the read cache /ride and /ramp already use.
 * Pull on boot, push on every local edit — the drift where a ramp-measured
 * FTP lived only in one browser while the server scored games with another
 * number is the bug this buries.
 */
type ProfileStore = ReturnType<typeof createProfileStore>;

/** Server → local, called from the root layout whenever `me` loads. */
export function pullProfile(profile: ProfileStore): void {
	const me = account.me;
	if (!me) return;
	// untrack: update() spreads the profile state internally, and an effect
	// must not subscribe to what it writes.
	untrack(() => {
		// LTHR joined the account in #1571. A browser that set one before
		// that, against an account that has none, is the one copy there is:
		// push it up instead of pulling the blank down over it.
		const local = profile.current.lthr;
		if (me.lthr == null && local) {
			void pushProfile({ lthr: local });
			profile.update({ ftp: me.ftpWatts, kg: me.weightKg });
			return;
		}
		profile.update({ ftp: me.ftpWatts, kg: me.weightKg, lthr: me.lthr });
	});
}

/**
 * Local → server. Returns the server's error message, or null — callers
 * surface it in their existing status line, the ride itself never blocks.
 */
export async function pushProfile(next: {
	ftpWatts?: number;
	weightKg?: number;
	/** 0 clears the anchor (#1571). */
	lthr?: number;
}): Promise<string | null> {
	const me = account.me;
	// Not a silent null (#1543): the caller reports the push, and a number
	// that never left this browser is overwritten from the server on the
	// next boot.
	if (!me) return 'Not signed in — the number was not saved to your account.';
	const err = await account.save({
		displayName: me.displayName,
		ftpWatts: next.ftpWatts ?? me.ftpWatts,
		weightKg: next.weightKg ?? me.weightKg,
		lthr: next.lthr,
	});
	return err ? err.message : null;
}
