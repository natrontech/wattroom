/**
 * What the FTP trend can draw, decided outside the SVG (#222, #1572). The
 * chart is one path plus two mark series; these are the three questions it
 * asks before drawing any of them, kept here so they can be tested without a
 * DOM the web suite has no harness for.
 */
import type { TrendRide } from '$lib/progression';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const atMs = (date: string) => new Date(date).getTime();

/**
 * The rides that PRODUCED an FTP — a ramp test whose number the rider
 * accepted, and nothing else (#1572). The line stays the FTP each ride was
 * scored against; these are the moments it moved, marked on the ride that
 * moved it instead of showing up a ride late.
 */
export const ftpMarks = (rides: TrendRide[]): TrendRide[] =>
	rides.filter((ride) => (ride.ftpAfter ?? 0) > 0);

/**
 * Not enough to draw (#1572): one day of rides gave a flat line across a
 * collapsed axis reading "9 Sept – 9 Sept", no dots, and nothing saying why.
 * Empty states teach (ux.md).
 *
 * Two rides is the floor whatever they contain — a single ride is a point,
 * and a point has no trend and no axis. Past that, a week of rides at one
 * unchanged FTP with no mark of any kind on it is still nothing to look at.
 */
export function trendSparse(rides: TrendRide[]): boolean {
	if (rides.length < 2) return true;
	const days = atMs(rides[rides.length - 1].date) - atMs(rides[0].date);
	const ftps = new Set(rides.map((ride) => ride.ftp));
	const marked = rides.some(
		(ride) => ride.best20m > 0 || (ride.ftpAfter ?? 0) > 0,
	);
	return days < WEEK_MS && ftps.size < 2 && !marked;
}

/**
 * The watts axis, wide enough for every mark it has to hold — the ramp's
 * produced FTP included, or the one dot the chart exists for would sit off
 * the top of it.
 */
export function trendDomain(rides: TrendRide[]): { lo: number; hi: number } {
	const watts = rides
		.flatMap((ride) => [ride.ftp, ride.best20m, ride.ftpAfter ?? 0])
		.filter((w) => w > 0);
	if (watts.length === 0) return { lo: 0, hi: 1 };
	const lo = Math.min(...watts);
	const hi = Math.max(...watts);
	const margin = Math.max((hi - lo) * 0.15, 10);
	return { lo: Math.max(lo - margin, 0), hi: hi + margin };
}
