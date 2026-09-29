import {
	BikeKg,
	PaceAirDensity,
	PaceCrr,
	PaceDrivetrainEfficiency,
	PaceGravity,
	PaceDefaultCdA,
	PaceSubsteps,
	ReferenceRiderKg,
	ReferenceRiderWatts,
} from '$lib/protocol';

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
	const sheltered = 1 - Math.min(1, Math.max(0, shelter));
	return (
		mass * PaceGravity * Math.sin(theta) +
		PaceCrr * mass * PaceGravity * Math.cos(theta) +
		0.5 * PaceAirDensity * cda * sheltered * v * v
	);
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

/** One rider's speed and distance on a road, advanced a second at a time. */
export function createPace(speed = 0) {
	let v = speed;
	let d = 0;
	return {
		/** m/s */
		get speed() {
			return v;
		},
		/** Metres ridden since the pace was created. */
		get distance() {
			return d;
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
			for (let i = 0; i < PaceSubsteps; i++) {
				const next = nextSpeed(
					v,
					mass,
					PaceDrivetrainEfficiency * watts,
					resistance(v, grade, mass, cda, shelter),
					dt,
				);
				d += ((v + next) / 2) * dt;
				v = next;
			}
		},
	};
}

export type Pace = ReturnType<typeof createPace>;

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
