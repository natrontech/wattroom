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
		/**
		 * The speed it starts at, m/s: a lap keeps the speed the one before
		 * it ended at, as the server's replay does (#3117).
		 */
		mps?: number;
		/** The felt grade's slew, kept from the lap before (#3025). */
		grade?: ReturnType<typeof createRideGrade>;
	},
) {
	const ridden = opts.reverse ? turnedRound(road) : road;
	const onStored = (along: number) =>
		opts.reverse ? road.length - along : along;
	const start = Math.min(Math.max(opts.from ?? 0, 0), road.length);
	const from = opts.reverse ? road.length - start : start;
	const pace = createPace(opts.mps ?? 0);
	const grade = opts.grade ?? createRideGrade();
	let lastAt: number | undefined;
	function place(seconds: number): RoadSecond {
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
	}
	return {
		road,
		from: start,
		/** Where it stands before its first second: where the lap starts. */
		start: (): RoadSecond => place(1),
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
			return place(seconds);
		},
	};
}

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
 * replay rides it by (#3598). A lap may start anywhere on the road: "Ride
 * with <name>" starts one at a channel-mate's metre (#3117).
 */
export function createRoadLaps(
	road: Road,
	opts: { kg: () => number; from?: number; reverse?: boolean },
) {
	let lap = 0;
	let reverse = !!opts.reverse;
	let opening = reverse;
	const grade = createRideGrade();
	let ride = createRoadRide(road, { ...opts, grade });
	let last: RoadSecond | null = null;
	let recorded = false;
	/** The next lap from `from` on the stored road, `way` along it. */
	function next(from: number, way: boolean) {
		reverse = way;
		// A lap nothing was recorded on is replaced, never numbered past: the
		// server takes laps one after another (#3598).
		if (recorded) lap += 1;
		recorded = false;
		opening = true;
		// From the start of its way a lap rides off from standstill; from
		// anywhere else it keeps this one's speed, as the replay does (#3117).
		const atStart = way ? from >= road.length : from <= 0;
		const mps = atStart ? 0 : (last?.virtualMps ?? 0);
		ride = createRoadRide(road, { kg: opts.kg, from, reverse, mps, grade });
	}
	return {
		road,
		get from() {
			return ride.from;
		},
		get lap() {
			return lap;
		},
		/** This lap runs back down the road, from its far end (#3205). */
		get reverse() {
			return reverse;
		},
		second: (watts: number, at: number): RoadSecond =>
			(last = ride.second(watts, at)),
		/** Where this lap starts, before its first second. */
		start: (): RoadSecond => ride.start(),
		/** The next lap, from the end this one reached (#3205). */
		turn(way: 'back' | 'again') {
			const back = way === 'back' ? !reverse : reverse;
			next(back ? road.length : 0, back);
		},
		/** The next lap from metre `m`, `way` down the stored road or up it (#3117). */
		jump(m: number, way: boolean) {
			next(m, way);
		},
		/** The recorded fields of a sample at `here`, once per recorded second. */
		fields(here: RoadSecond): RoadSampleFields {
			const out: RoadSampleFields = { m: here.m, alt: here.alt };
			if (lap > 0) out.lap = lap;
			if (opening && reverse) out.reverse = true;
			opening = false;
			recorded = true;
			return out;
		},
	};
}
