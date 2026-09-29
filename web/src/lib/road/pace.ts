import {
	BikeKg,
	PaceAirDensity,
	PaceBrakeMps2,
	PaceCornerG,
	PaceCrr,
	PaceDrivetrainEfficiency,
	PaceGravity,
	PaceDefaultCdA,
	PaceSubsteps,
	ReferenceRiderKg,
	ReferenceRiderWatts,
	ShelterAdjacent,
	ShelterFullGapM,
	ShelterMax,
	ShelterNoneGapM,
	ShelterSecondWheel,
	ShelterThirdWheel,
} from '$lib/protocol';
import { roadStep, type Road } from './road';

/**
 * The pace model (#3048): watts to speed on a road, the one the client's
 * dot, the hub's bunch, stats replay and races share. Its twin is
 * server/internal/road; the golden vectors in
 * server/internal/protocol/testdata hold the two to 0.1 %.
 *
 * Martin et al. 1998, stepped once a second in PaceSubsteps substeps and
 * integrated as kinetic energy, so a rider carries speed over a crest, gains
 * it downhill, and rolls away from a standstill without a P/v singularity:
 *
 *   ½·m·v² += (η·P − (m·g·sinθ + Crr·m·g·cosθ + ½·ρ·CdA·(1 − shelter)·v²)·v)·dt
 *
 * ponytail: no wheel inertia and no wind; Martin's I/r² term is a few
 * percent of a bike's mass, add it when a race is decided by a sprint's
 * first second.
 */

/** Everything but the rider's own power, in newtons, at speed v. */
function resistance(
	v: number,
	grade: number,
	mass: number,
	cda: number,
	shelter: number,
): number {
	const theta = Math.atan(grade / 100);
	// No draft takes more than ShelterMax of the air (a rule, ADR-0077),
	// whatever a caller hands in.
	const sheltered = 1 - Math.min(ShelterMax, Math.max(0, shelter));
	return (
		mass * PaceGravity * Math.sin(theta) +
		PaceCrr * mass * PaceGravity * Math.cos(theta) +
		0.5 * PaceAirDensity * cda * sheltered * v * v
	);
}

/**
 * The share of a rider's air drag the wheels ahead take (#3233, docs/SPEC.md
 * "Drafting"): by where they are in the line — lineIndex 0 is the front, with
 * nothing ahead, 1 the second wheel, 2 the third — how far behind the wheel
 * ahead they ride, in metres, and how many lanes over. A wheel within
 * ShelterFullGapM gives it whole, fading to none at ShelterNoneGapM; the
 * adjacent lane gets half, and two lanes over nothing. Never more than
 * ShelterMax. The hub computes it (ADR-0077); step() takes it as its
 * shelter. The Go twin is road.Shelter.
 */
export function shelter(
	gapM: number,
	laneDelta: number,
	lineIndex: number,
): number {
	if (lineIndex < 1 || gapM >= ShelterNoneGapM) return 0;
	let share =
		lineIndex === 1
			? ShelterSecondWheel
			: lineIndex === 2
				? ShelterThirdWheel
				: ShelterMax;
	if (gapM > ShelterFullGapM)
		share *= (ShelterNoneGapM - gapM) / (ShelterNoneGapM - ShelterFullGapM);
	const lanes = Math.abs(laneDelta);
	if (lanes === 1) share *= ShelterAdjacent;
	else if (lanes > 1) return 0;
	return Math.min(share, ShelterMax);
}

/**
 * One substep of the model: kinetic energy after dt at this driving power
 * (watts at the wheel) against this resistance (newtons at speed v). The
 * SimulatedTrainer's flywheel runs on it too, against the trainer's own road
 * rather than the dot's (#3050).
 */
export function nextSpeed(
	v: number,
	mass: number,
	drive: number,
	force: number,
	dt: number,
): number {
	const energy = 0.5 * mass * v * v + (drive - force * v) * dt;
	return energy > 0 ? Math.sqrt((2 * energy) / mass) : 0;
}

/**
 * The fastest a rider may go at a distance along a road whose curvature
 * (1/m, either sign) is sampled every `step` metres (#3204). A bend of radius
 * r holds √(aLat·r); ahead of it the limit rises by what braking at
 * PaceBrakeMps2 sheds, so the pace slows into the bend and never has to stop
 * dead at its apex. Past the last sample, and on a road that never bends,
 * there is no limit. The Go twin is road.CornerLimit.
 */
export function cornerLimit(
	curvature: ArrayLike<number>,
	step: number,
): (distance: number) => number {
	const aLat = PaceCornerG * PaceGravity;
	const env = new Float64Array(curvature.length);
	for (let i = curvature.length - 1; i >= 0; i--) {
		const k = Math.abs(curvature[i]);
		env[i] = k > 0 ? Math.sqrt(aLat / k) : Infinity;
		if (i + 1 < env.length)
			env[i] = Math.min(
				env[i],
				Math.sqrt(env[i + 1] * env[i + 1] + 2 * PaceBrakeMps2 * step),
			);
	}
	return (d) => {
		if (env.length === 0 || d >= (env.length - 1) * step) return Infinity;
		if (d <= 0) return env[0];
		const i = Math.floor(d / step);
		const t = d / step - i;
		const a = env[i];
		const b = env[i + 1];
		if (b === Infinity) return t > 0 ? b : a;
		// Braking at a constant rate is linear in v², so between samples the
		// envelope is too.
		return Math.sqrt(a * a + (b * b - a * a) * t);
	};
}

/**
 * One rider's speed and distance on a road, advanced a second at a time.
 * `limit` is cornerLimit's envelope, offset to where this pace started;
 * without one the road never bends.
 */
export function createPace(speed = 0, limit?: (distance: number) => number) {
	let v = speed;
	let d = 0;
	let braking = false;
	return {
		/** m/s */
		get speed() {
			return v;
		},
		/** Metres ridden since the pace was created. */
		get distance() {
			return d;
		},
		/** The last step held the rider under the limit: the figure sits up for the bend (#3071). */
		get braking() {
			return braking;
		},
		/**
		 * One second at these watts, on this grade (%), for this total mass
		 * (rider and bike, kg), CdA (m²) and shelter (the fraction of the air
		 * the bunch takes, 0–1). Exactly these five: no gear and no trainer
		 * speed ever reaches the dot (ADR-0084), and a test pins the names.
		 */
		step(
			watts: number,
			grade: number,
			mass: number,
			cda: number,
			shelter: number,
		): void {
			const dt = 1 / PaceSubsteps;
			braking = false;
			for (let i = 0; i < PaceSubsteps; i++) {
				let next = nextSpeed(
					v,
					mass,
					PaceDrivetrainEfficiency * watts,
					resistance(v, grade, mass, cda, shelter),
					dt,
				);
				// Held to the road where this substep ends, at the farthest it
				// could reach: the envelope only falls toward a bend, so that is
				// the stricter end, and the apex is met, not overshot.
				if (limit) {
					const cap = limit(d + ((v + next) / 2) * dt);
					if (next > cap) {
						next = cap;
						braking = true;
					}
				}
				d += ((v + next) / 2) * dt;
				v = next;
			}
		},
	};
}

export type Pace = ReturnType<typeof createPace>;

/**
 * One second of the dot (ADR-0084): it moves by the watts the rider made, on
 * the road's own grade — never by the trainer's speed, and never by a gear.
 */
export function dotSecond(
	pace: Pace,
	sample: { watts: number },
	grade: number,
	mass: number,
	cda: number,
	shelter: number,
): void {
	pace.step(sample.watts, grade, mass, cda, shelter);
}

/** The speed these watts hold on this grade once the rider settles, m/s. */
export function steadySpeed(
	watts: number,
	grade: number,
	mass: number,
	cda: number,
	shelter = 0,
): number {
	let lo = 0;
	let hi = 40;
	for (let k = 0; k < 60; k++) {
		const mid = (lo + hi) / 2;
		const power = resistance(mid, grade, mass, cda, shelter) * mid;
		if (PaceDrivetrainEfficiency * watts > power) lo = mid;
		else hi = mid;
	}
	return lo;
}

/**
 * The reference rider's steady speed on this grade, m/s: whom a road's
 * estimates and schedules are timed against (docs/SPEC.md).
 */
export function referenceSpeed(grade: number): number {
	return steadySpeed(
		ReferenceRiderWatts,
		grade,
		ReferenceRiderKg + BikeKg,
		PaceDefaultCdA,
	);
}

/**
 * How long the reference rider takes over a road, in seconds: what a route's
 * legs are cut by (docs/SPEC.md "Leg", #3057), whoever is about to ride it.
 */
export function referenceSeconds(road: Road): number {
	const step = roadStep(road);
	let seconds = 0;
	for (let i = 1; i < road.heights.length; i++)
		seconds +=
			step /
			referenceSpeed(((road.heights[i] - road.heights[i - 1]) / step) * 100);
	return seconds;
}
