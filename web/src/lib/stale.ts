/**
 * Reads failed in a row before a feed is marked stale (#1743): the SECOND
 * failure, never the first — the fallback poll already covers a one-off, and
 * a mark that flickers on every blip teaches people to ignore it. The crew
 * list's and the crews' live read's alike (#2518).
 */
export const STALE_AFTER = 2;

/**
 * Orders the overlapping reads of one feed (#2565). A response older than one
 * already applied is dropped, so a slow success can neither clear a newer
 * failure's count nor put an older list back; every other response lands, so
 * two overlapping failures are two failures. `begin()` numbers a read as it
 * is asked, `lands(n)` says whether its answer may be applied, and `reset()`
 * drops everything still in flight.
 */
export function readOrder() {
	let asked = 0;
	let applied = 0;
	return {
		begin: () => ++asked,
		lands(n: number) {
			if (n < applied) return false;
			applied = n;
			return true;
		},
		reset() {
			applied = ++asked;
		},
	};
}
