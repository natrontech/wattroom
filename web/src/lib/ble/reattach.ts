/**
 * The waits before each reattach after a dropout (#37, #1716), the last one
 * repeating: the first at once, then 1, 2 and 5 s. It was 1 s doubling to
 * 30 s, so a trainer back in range after twenty seconds waited up to half a
 * minute more, and its riders pedalled a block blind. Trying again costs one
 * GATT connect that fails fast, against a rider three metres from the screen
 * mid-interval (WATTROOM.md: trainer reconnect mid-interval is core).
 */
export const REATTACH_MS = [0, 1000, 2000, 5000] as const;

/** The wait before reattach attempt `n`, counted from 0 since the link was last up. */
export const reattachDelay = (n: number): number =>
	REATTACH_MS[Math.min(n, REATTACH_MS.length - 1)];

/**
 * Reattach after a dropout, on REATTACH_MS, until `settled` says the link is
 * back or the rider let go. The grant persists in-page, so no chooser opens:
 * a rider on a bike cannot answer one.
 */
export function createReattach(
	attach: () => Promise<void>,
	settled: () => boolean,
) {
	let attempts = 0;
	function schedule(): void {
		setTimeout(() => {
			if (settled()) return;
			void attach().catch(schedule);
		}, reattachDelay(attempts++));
	}
	return {
		schedule,
		/** The link is up: the next dropout starts again at once. */
		reset() {
			attempts = 0;
		},
	};
}
