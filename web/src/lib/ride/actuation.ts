import type { Trainer } from '$lib/ble/trainer';

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
 * both steps of a sprint's entry, and a target's flat road. One entry point,
 * so composing the grade with gears and shelter, and the write policy that
 * never pulses, land in one place (#3327).
 */
export function simulate(
	trainer: Trainer,
	gradePercent: number,
): Promise<void> {
	return trainer.setSimulation(gradePercent);
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
 * What one ride writes to its trainer: a target, a grade, or a sprint. The
 * solo ride and the session ride each carried their own copy of the sprint
 * (#3049); both now say what they want and this decides the writes.
 *
 * The trainer is read at each write rather than captured, so a trainer
 * swapped mid-ride (#1847) is the one that gets the hill.
 */
export function createActuator(trainer: () => Trainer | null | undefined) {
	// In slope for a sprint, so the flip happens once per window.
	let sprinting = false;
	// The hill is a second write 500 ms after the flat; a ride ending inside
	// that gap wrote the grade after the release (#1852).
	let hill: ReturnType<typeof setTimeout> | undefined;

	/** Out of the sprint: the next sprint flips again, and a pending hill never lands. */
	function release() {
		clearTimeout(hill);
		hill = undefined;
		sprinting = false;
	}

	return {
		/**
		 * The sprint, once per window. Slope has no usable range on a
		 * single-speed setup (Zwift Cog), so there it runs as a target nobody
		 * holds instead (#30/#41). Otherwise flat first, then the hill: an FTMS
		 * trainer has to leave ERG before the grade lands.
		 */
		sprint(setup: SprintSetup, ftp: number) {
			const held = trainer();
			if (sprinting || !held) return;
			sprinting = true;
			if (setup.singleSpeed) {
				void held.setTargetPower(ftp * 2);
				return;
			}
			const grade = sprintSlope(setup);
			void simulate(held, 0);
			hill = setTimeout(() => {
				hill = undefined;
				const now = trainer();
				if (sprinting && now) void simulate(now, grade);
			}, 500);
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
