import { BikeKg, PaceDefaultCdA } from '$lib/protocol';
import { gradeAt, heightAt } from '$lib/road/at-metre';
import { createPace } from '$lib/road/pace';
import { turnedRound, type Road } from '$lib/road/road';
import { createRideGrade } from '$lib/ride/ride-grade';

/** A second on the road: where the dot is, and what the trainer rides there. */
export interface RoadSecond {
	/** Metres along the road. */
	m: number;
	/** The road's height there. */
	alt: number;
	/** The dot's speed, m/s — the virtual speed "riding on a road" reads (#3056). */
	virtualMps: number;
	/** The road's own grade there, %. */
	roadPct: number;
	/** The grade the trainer rides: felt, a second ahead, slewed (#3025). */
	felt: number;
	/** The dot has reached the end of the way it rides (#3205). */
	atEnd: boolean;
}

/**
 * A ride on a stored road (#3027, ADR-0062). The dot moves by the rider's
 * watts on the road's own grade — never by the trainer's speed or a gear
 * (ADR-0084) — stepped exactly as the server's replay steps it (ADR-0074),
 * so the metres a ride reports are the metres it keeps.
 */
export function createRoadRide(
	road: Road,
	opts: {
		/** The rider's weight, kg; the bike's is added, as the replay adds it. */
		kg: () => number;
		/** Where on the road the ride starts: a resumed ride's metre. */
		from?: number;
		/**
		 * Down the road from its far end — "Ride back the way you came"
		 * (#3205). `m` stays metres along the stored road, so it counts down.
		 */
		reverse?: boolean;
	},
) {
	const ridden = opts.reverse ? turnedRound(road) : road;
	const onStored = (along: number) =>
		opts.reverse ? road.length - along : along;
	const start = Math.min(Math.max(opts.from ?? 0, 0), road.length);
	const from = opts.reverse ? road.length - start : start;
	const pace = createPace();
	const grade = createRideGrade();
	let lastAt: number | undefined;
	return {
		road,
		from: start,
		/**
		 * One sample at `at` (ms). The dot moves by the whole seconds since the
		 * last, held to 0–2: a tab the browser throttled catches up a little,
		 * and never teleports down the road.
		 */
		second(watts: number, at: number): RoadSecond {
			const seconds =
				lastAt === undefined
					? 1
					: Math.min(2, Math.max(0, Math.round((at - lastAt) / 1000)));
			lastAt = at;
			for (let i = 0; i < seconds; i++) {
				const along = from + pace.distance;
				if (along >= ridden.length) break;
				pace.step(
					watts,
					gradeAt(ridden, along),
					opts.kg() + BikeKg,
					PaceDefaultCdA,
					0,
				);
			}
			const along = Math.min(from + pace.distance, ridden.length);
			// The dot stops at the end of its way; what comes next is the
			// rider's pick (#3205).
			const atEnd = along >= ridden.length;
			const moving = atEnd ? 0 : pace.speed;
			const m = onStored(along);
			return {
				m,
				alt: heightAt(road, m),
				virtualMps: moving,
				roadPct: gradeAt(ridden, along),
				felt: grade.road(ridden, along, moving, Math.max(1, seconds)),
				atEnd,
			};
		},
	};
}

export type RoadRide = ReturnType<typeof createRoadRide>;

/** A sample's place on the road, as the upload and the crash buffer keep it. */
export interface RoadSampleFields {
	m: number;
	alt: number;
	/** The lap (#3598); absent on the first. */
	lap?: number;
	/** On a lap's first sample: it runs down the stored road. */
	reverse?: true;
}

/**
 * One ride along a road, lap by lap (#3205): at its end the rider rides back
 * the way they came or rides it again, and it stays one ride. Every sample
 * says its lap and a lap's first says which way it runs — what the server's
 * replay rides it by (#3598).
 */
export function createRoadLaps(
	road: Road,
	opts: { kg: () => number; from?: number },
) {
	let lap = 0;
	let reverse = false;
	let opening = false;
	let ride = createRoadRide(road, opts);
	return {
		road,
		get from() {
			return ride.from;
		},
		get lap() {
			return lap;
		},
		second: (watts: number, at: number): RoadSecond => ride.second(watts, at),
		/** The next lap, from the end this one reached (#3205). */
		turn(way: 'back' | 'again') {
			if (way === 'back') reverse = !reverse;
			lap += 1;
			opening = true;
			ride = createRoadRide(road, {
				kg: opts.kg,
				from: reverse ? road.length : 0,
				reverse,
			});
		},
		/** The recorded fields of a sample at `here`, once per recorded second. */
		fields(here: RoadSecond): RoadSampleFields {
			const out: RoadSampleFields = { m: here.m, alt: here.alt };
			if (lap > 0) out.lap = lap;
			if (opening && reverse) out.reverse = true;
			opening = false;
			return out;
		},
	};
}

export type RoadLaps = ReturnType<typeof createRoadLaps>;
