import type { ServerRide } from '$lib/ride/list';

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * Your last seven days on the bike: what Home's "this week" tile and the
 * crew Home's line both say (#2586), from one sum so they cannot disagree.
 */
export function weekTotals(
	rides: readonly Pick<ServerRide, 'startedAt' | 'seconds' | 'kj'>[],
	now = Date.now(),
): { count: number; minutes: number; kj: number } {
	const recent = rides.filter(
		(ride) => Date.parse(ride.startedAt) > now - WEEK_MS,
	);
	return {
		count: recent.length,
		minutes: Math.round(
			recent.reduce((sum, ride) => sum + ride.seconds, 0) / 60,
		),
		kj: Math.round(recent.reduce((sum, ride) => sum + ride.kj, 0)),
	};
}
