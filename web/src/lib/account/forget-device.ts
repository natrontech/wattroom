import { forgetHistoryOf } from '$lib/history.svelte';
import { forgetProfile } from '$lib/profile.svelte';
import { discardRidesOf } from '$lib/ride/buffer';

/**
 * The device half of deleting an account (#2805) — WATTROOM.md's full purge
 * reaches this browser too. The server has forgotten the rider; this forgets
 * what the browser kept for them: the crash buffer's rides with their heart
 * rate, the ride summaries only this device held, and the cached FTP, weight
 * and LTHR. Another account's rides on the same browser stay theirs.
 *
 * Only after the server said yes: a refused delete removed nothing, and must
 * not have removed this either.
 */
export async function forgetAccountHere(ownerId: string): Promise<void> {
	await discardRidesOf(ownerId);
	forgetHistoryOf(ownerId);
	forgetProfile();
}
