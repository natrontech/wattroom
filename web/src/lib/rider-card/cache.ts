import type { Rider } from '$lib/rider';

/**
 * The last rider page read per id, for the hover card (#2739): a pointer
 * crossing a member list opens the same few cards over and over, and each
 * would otherwise read the whole page again. Half a minute is fresher than
 * the page's own lobby-ping refresh needs to be for a glance.
 */
const TTL_MS = 30_000;
const riders = new Map<string, { at: number; rider: Rider }>();

/** The cached read, or null once it is stale; given `fresh`, remembers it. */
export function cachedRider(id: string, fresh?: Rider): Rider | null {
	if (fresh) {
		riders.set(id, { at: Date.now(), rider: fresh });
		return fresh;
	}
	const hit = riders.get(id);
	return hit && Date.now() - hit.at < TTL_MS ? hit.rider : null;
}
