import { BikeKg, PaceDefaultCdA } from '$lib/protocol';
import { gradeAt, heightAt } from '$lib/road/at-metre';
import { createPace } from '$lib/road/pace';
import type { Road } from '$lib/road/road';
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
	},
) {
	const from = Math.min(Math.max(opts.from ?? 0, 0), road.length);
	const pace = createPace();
	const grade = createRideGrade();
	let lastAt: number | undefined;
	return {
		road,
		from,
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
				const m = from + pace.distance;
				if (m >= road.length) break;
				pace.step(
					watts,
					gradeAt(road, m),
					opts.kg() + BikeKg,
					PaceDefaultCdA,
					0,
				);
			}
			const m = Math.min(from + pace.distance, road.length);
			// The end of the road is #3205's: until then the dot stops there.
			const moving = m < road.length ? pace.speed : 0;
			return {
				m,
				alt: heightAt(road, m),
				virtualMps: moving,
				roadPct: gradeAt(road, m),
				felt: grade.road(road, m, moving, Math.max(1, seconds)),
			};
		},
	};
}

export type RoadRide = ReturnType<typeof createRoadRide>;
