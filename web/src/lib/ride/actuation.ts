import type { Trainer } from '$lib/ble/trainer';
import { MaxTrainerGrade, MinTrainerGrade } from '$lib/protocol';
import { ROAD } from '$lib/ride/ride-grade';

/** The rider's sprint setup (#30/#41), read per sprint so a change on /settings lands mid-ride. */
export interface SprintSetup {
	grade: number;
	singleSpeed: boolean;
}

/**
 * The grade a sprint rides: the rider's own sprint grade while there is no
 * road. On a road it becomes the road's grade under them (#3025, #3102).
 * A Prime a spectator arms is not this rider's sprint and never gets here.
 */
export function sprintSlope(setup: SprintSetup): number {
	return setup.grade;
}

/**
 * Every SIM write the ride makes goes through here: the free ride's grade,
 * a road's, both steps of a sprint's entry, and a target's flat road. One
 * entry point, so composing the grade with gears and shelter, and the write
 * policy that never pulses, land in one place (#3327). The grade written is
 * held to one range for every trainer (docs/SPEC.md, ADR-0062).
 */
export function simulate(
	trainer: Trainer,
	gradePercent: number,
): Promise<void> {
	const gradePct = Math.min(
		MaxTrainerGrade,
		Math.max(MinTrainerGrade, gradePercent),
	);
	return trainer.setSimulation({ gradePct });
}

/**
 * A ride's target, or a flat road where it has none (#2658). Zero in ERG is a
 * freewheel: every guard release, count-in and gap between sessions wrote it,
 * and the rider pedalled against nothing. Letting go of the trainer — Stop,
 * leaving — still writes ERG 0 W; nobody is riding it then.
 */
export function holdTarget(trainer: Trainer, watts: number): Promise<void> {
	return watts > 0 ? trainer.setTargetPower(watts) : simulate(trainer, 0);
}

/**
 * What one ride writes to its trainer: a target, a grade, a road or a sprint. The
 * solo ride and the session ride each carried their own copy of the sprint
 * (#3049); both now say what they want and this decides the writes.
 *
 * The trainer is read at each write rather than captured, so a trainer
 * swapped mid-ride (#1847) is the one that gets the hill.
 */
export function createActuator(trainer: () => Trainer | null | undefined) {
	// In slope for a sprint, so the flip happens once per window.
	let sprinting = false;
	// The grade an entry's flat gives way to, read when the flat ends and not
	// when it began: a grade asked for inside it is the one that lands.
	let wanted: number | undefined;
	// The flat on entering SIM from ERG. A ride ending inside it used to get
	// the grade after its release (#1852), so release() clears it.
	let entry: ReturnType<typeof setTimeout> | undefined;

	/** Out of the sprint and off the road: the next flips again, and a pending grade never lands. */
	function release() {
		clearTimeout(entry);
		entry = undefined;
		wanted = undefined;
		sprinting = false;
	}

	/**
	 * A road's or a sprint's grade. Flat first only on entering SIM from ERG,
	 * where an FTMS trainer has to leave ERG before the grade lands; already
	 * in SIM, it is written at once.
	 */
	function slope(held: Trainer, percent: number) {
		wanted = percent;
		if (entry) return;
		if (held.mode !== 'erg') {
			void simulate(held, percent);
			return;
		}
		void simulate(held, 0);
		entry = setTimeout(() => {
			entry = undefined;
			const now = trainer();
			if (now && wanted !== undefined) void simulate(now, wanted);
		}, ROAD.entryFlatMs);
	}

	return {
		/**
		 * The sprint, once per window. Slope has no usable range on a
		 * single-speed setup (Zwift Cog), so there it runs as a target nobody
		 * holds instead (#30/#41). Otherwise the hill, flat first out of ERG.
		 */
		sprint(setup: SprintSetup, ftp: number) {
			const held = trainer();
			if (sprinting || !held) return;
			sprinting = true;
			if (setup.singleSpeed) {
				void held.setTargetPower(ftp * 2);
				return;
			}
			slope(held, sprintSlope(setup));
		},
		/** This second's grade from createRideGrade — roads only. */
		road(percent: number) {
			sprinting = false;
			const held = trainer();
			if (held) slope(held, percent);
		},
		/** Hold a target, or a flat road where there is none. */
		hold(watts: number) {
			release();
			const held = trainer();
			if (held) void holdTarget(held, watts);
		},
		/** A grade the rider chose — a free ride's slope, not a target to hold. */
		grade(percent: number) {
			release();
			const held = trainer();
			if (held) void simulate(held, percent);
		},
		release,
	};
}
