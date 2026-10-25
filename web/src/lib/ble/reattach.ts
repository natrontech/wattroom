/**
 * Reattach after a dropout (#37, #1716): 1 s, doubling to 30 s, until
 * `settled` says the link is back or the rider let go. The grant persists
 * in-page, so no chooser opens: a rider on a bike cannot answer one.
 */
export function createReattach(
	attach: () => Promise<void>,
	settled: () => boolean,
) {
	let delayMs = 1000;
	function schedule(): void {
		const delay = delayMs;
		delayMs = Math.min(delay * 2, 30_000);
		setTimeout(() => {
			if (settled()) return;
			void attach().catch(schedule);
		}, delay);
	}
	return {
		schedule,
		/** The link is up: the next dropout starts again at 1 s. */
		reset() {
			delayMs = 1000;
		},
	};
}
