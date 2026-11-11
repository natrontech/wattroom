import { formatKm } from '#lib/format.ts';
import { MaxRoadSpeedMps } from '#lib/protocol.ts';
import { zoneOf } from '#lib/components/zones.ts';
import type { ClimbBest } from '#lib/road/attempts.ts';
import { classedOf, climbsOf, type ClimbClass } from '#lib/road/climbs.ts';
import { gainOf } from '#lib/road/profile.ts';
import type { Road } from '#lib/road/road.ts';
import { rideProfile } from './ride-profile';

/**
 * A road ride's section of the closing card (#4516): the road as the rider
 * rode it, their zones along it, the stretch in numbers and the classed
 * climbs they went up. Drawn from the rider's own seconds — their metres and
 * heights, never a coordinate — the way the ride's page draws its Skyline
 * (#3639), so the card shows nothing of the road the rider has not already
 * seen of it, and keeps nothing (ADR-0058).
 */

/** One second of the ride, as the save and the ride's own read carry it. */
export interface RoadSample {
	watts: number;
	/** Metres along the road; 0 or absent off it. */
	m?: number;
	alt?: number;
	/** The lap (#3598); absent on the first. */
	lap?: number;
	/** On a lap's first second: it runs down the stored road. */
	reverse?: boolean;
}

export interface RecapClimb {
	cls: ClimbClass;
	startM: number;
	topM: number;
	gainM: number;
	/** Foot to summit; absent where the ride times nobody (ADR-0074). */
	seconds?: number;
	/** Your best up it, this ride (the route's climb bests, #3033). */
	pr?: boolean;
}

export interface RoadRecap {
	/** The road as ridden: its own metres from 0, laps and all. */
	profile: Road;
	/** "km 3.2–14.8 · 412 m", or the whole length on more than one lap. */
	stretch: string;
	climbs: RecapClimb[];
	/** Each column's zone over the ridden metres, `columns` wide; 0 unridden. */
	zones: number[];
}

/**
 * The section, or null for a ride that never placed a second on a road.
 *
 * `route` is the route's stored road, when the card has it: a ride of one
 * lap down the road then reads its climbs in the route's own metres, the
 * ones its bests are kept by. Otherwise the climbs are the ride's own
 * profile's, which is what a lap, a turn or a bunch's seconds rode.
 * `timed` is ADR-0074's word: false on a bunch ride, which tows its riders
 * and times nobody, so no climb carries a time there.
 */
export function roadRecap(
	samples: readonly RoadSample[],
	options: { ftp: number; timed: boolean; route?: Road; columns?: number },
): RoadRecap | null {
	if (!samples.some((s) => (s.m ?? 0) > 0)) return null;
	const profile = rideProfile(samples);
	if (!profile) return null;
	const ridden = riddenMetres(samples);
	const placed = samples.flatMap((s, i) => ((s.m ?? 0) > 0 ? [i] : []));
	const first = placed[0];
	const last = placed.at(-1)!;
	const oneLap =
		samples.every((s) => !s.lap && !s.reverse) &&
		samples[last].m! > samples[first].m!;
	const gain = Math.round(gainOf(profile.heights));
	const stretch = oneLap
		? `km ${formatKm(samples[first].m!)}–${formatKm(samples[last].m!)} · ${gain} m`
		: `${formatKm(profile.length)} km · ${gain} m, laps and all`;

	let climbs: RecapClimb[];
	if (oneLap && options.route) {
		// The route's own climbs, in its metres: a climb is one the ride went
		// up when it passed both its foot and its summit, the way the server
		// times it (routes/attempts.go timeUp).
		const metres = samples.map((s) => s.m ?? 0);
		climbs = classedOf(climbsOf(options.route)).flatMap((c) => {
			const seconds = timeUp(metres, c.startM, c.topM);
			return seconds === undefined ? [] : [{ ...c, seconds }];
		});
	} else {
		climbs = classedOf(climbsOf(profile)).map((c) => ({
			...c,
			seconds: timeUp(ridden, c.startM, c.topM),
		}));
	}
	if (!options.timed)
		climbs = climbs.map((c) => ({ ...c, seconds: undefined }));
	return {
		profile,
		stretch,
		climbs: climbs.map(({ cls, startM, topM, gainM, seconds }) => ({
			cls,
			startM,
			topM,
			gainM,
			...(seconds !== undefined && { seconds }),
		})),
		zones: zoneColumns(samples, ridden, options.ftp, options.columns ?? 120),
	};
}

/**
 * Seconds from `from` to `to` along a ride's metres, read between seconds;
 * undefined unless the ride passed both, in that order. The server's
 * timeUp (routes/attempts.go) in TypeScript, so the card's time and the
 * route's best are the same reading.
 */
export function timeUp(
	metres: readonly number[],
	from: number,
	to: number,
): number | undefined {
	const at = (m: number): number | undefined => {
		for (let i = 1; i < metres.length; i++) {
			if (metres[i - 1] <= m && metres[i] >= m && metres[i] > metres[i - 1])
				return i - 1 + (m - metres[i - 1]) / (metres[i] - metres[i - 1]);
		}
		return undefined;
	};
	const a = at(from);
	const b = at(to);
	if (a === undefined || b === undefined || b <= a) return undefined;
	return Math.round(b - a);
}

/**
 * The climbs this ride set the route's best on (#3033's climb bests, read
 * after the save): the best is this ride's, at the same foot and summit.
 */
export function withBests(
	climbs: readonly RecapClimb[],
	bests: readonly ClimbBest[],
	rideId: string,
): RecapClimb[] {
	const same = (a: number, b: number) => Math.abs(a - b) < 1;
	return climbs.map((c) =>
		c.seconds !== undefined &&
		bests.some(
			(b) =>
				b.rideId === rideId && same(b.startM, c.startM) && same(b.topM, c.topM),
		)
			? { ...c, pr: true }
			: c,
	);
}

/** Metres ridden by each second, from 0: what rideProfile draws along. */
function riddenMetres(samples: readonly RoadSample[]): number[] {
	const out = [0];
	for (let i = 1; i < samples.length; i++) {
		const step = Math.abs((samples[i].m ?? 0) - (samples[i - 1].m ?? 0));
		// A jump further than a second rides is a new lap, as rideProfile reads it.
		out.push(out[i - 1] + (step <= MaxRoadSpeedMps ? step : 0));
	}
	return out;
}

/** The zone ridden over each column of the ridden metres: the mean watts there. */
function zoneColumns(
	samples: readonly RoadSample[],
	ridden: readonly number[],
	ftp: number,
	columns: number,
): number[] {
	const length = ridden.at(-1) ?? 0;
	const sum = Array<number>(columns).fill(0);
	const count = Array<number>(columns).fill(0);
	if (length <= 0) return sum;
	for (let i = 0; i < samples.length; i++) {
		if ((samples[i].m ?? 0) <= 0) continue;
		const col = Math.min(
			columns - 1,
			Math.floor((ridden[i] / length) * columns),
		);
		sum[col] += samples[i].watts;
		count[col]++;
	}
	// A column narrower than a second's metres holds no second of its own:
	// it was ridden in the zone of the second before it, not left blank.
	const zones: number[] = [];
	for (let i = 0; i < columns; i++)
		zones.push(
			count[i] > 0 ? zoneOf(sum[i] / count[i], ftp) : (zones[i - 1] ?? 0),
		);
	return zones;
}
