import { encodeSimulation } from '$lib/ble/ftms';
import type { SimParams, Trainer, TrainerSample } from '$lib/ble/trainer';
import { MaxTrainerGrade, MinTrainerGrade } from '$lib/protocol';
import {
	gearSpace,
	ratioState,
	simTransform,
	trackRatio,
	type Clamp,
} from '$lib/ride/drivetrain';
import { gearsEnabled } from '$lib/ride/gears-enabled';
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
 * A bare grade, held to the write range every trainer shares (docs/SPEC.md,
 * ADR-0062): the entry flat, and /dev/hardware's own probes. Everything a
 * ride writes in SIM is composed instead.
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
 * The one composer every SIM write goes through (ADR-0084, #3327), in its
 * order: the felt input — a road's felt grade from rideGrade(), the free
 * ride's hand-set grade or a sprint's slope, none of which difficulty
 * touches here — then shelter while "Feel the draft" is on, the gear, and
 * the clamp to the write range.
 */
export function composeSim(
	input: { feltPct: number },
	shelter: number,
	k: number,
	draftOn: boolean,
	vFwLast = 0,
): { road: Required<SimParams>; clamp: Clamp } {
	return simTransform(
		{ gradePct: input.feltPct },
		draftOn ? shelter : 0,
		k,
		vFwLast,
	);
}

const bytes = (road: SimParams) =>
	Array.from(new Uint8Array(encodeSimulation(road))).join();
const FLAT = bytes({ gradePct: 0 });

/**
 * What one ride writes to its trainer: a target, a grade, a road or a sprint,
 * at the rider's gear. The solo ride and the session ride each say what they
 * want (#3049), and this decides the writes, under ADR-0084's policy:
 * - a shift is one composed write at once, and never a mode change;
 * - terrain is written when the composed bytes change;
 * - entering SIM from ERG writes a flat for ROAD.entryFlatMs first — the only
 *   write that is not the target road. A shift inside it moves k only, and
 *   its timed write reads the gear and the road when it fires;
 * - a reconnect re-issues the current state, recomputed (#1846).
 *
 * The gear starts at k = 1 on each ride. The trainer is read at each write
 * rather than captured, so a trainer swapped mid-ride (#1847) is the one
 * that gets the next write.
 */
export function createActuator(
	trainer: () => Trainer | null | undefined,
	onGearReset: () => void = () => {},
) {
	// What the ride wants: watts to hold, or a felt grade to ride.
	let intent: { watts: number } | { felt: number } | undefined;
	// In slope for a sprint, so the flip happens once per window.
	let sprinting = false;
	let k = 1;
	const ratio = ratioState();
	let shelter = 0;
	let draftOn = false;
	let clamp: Clamp = null;
	let entry: ReturnType<typeof setTimeout> | undefined;
	// Another of the rider's screens took the trainer (#1853).
	let lost = false;
	// The last SIM bytes written and to which trainer, so unchanged terrain
	// writes nothing — and a trainer swapped in (#1847) is written afresh.
	let written: { to: Trainer; bytes: string } | undefined;

	function compose(felt: number) {
		const out = composeSim({ feltPct: felt }, shelter, k, draftOn, ratio.speed);
		clamp = out.clamp;
		return out.road;
	}

	/** The current felt road at the current gear, unless the trainer already holds it. */
	function writeRoad(held: Trainer, force: boolean) {
		if (!intent || !('felt' in intent)) return;
		const road = compose(intent.felt);
		const next = bytes(road);
		if (!force && written?.to === held && written.bytes === next) return;
		written = { to: held, bytes: next };
		void held.setSimulation(road);
	}

	function toSim(felt: number) {
		intent = { felt };
		const held = trainer();
		if (!held || entry) return;
		if (held.mode !== 'erg') {
			writeRoad(held, false);
			return;
		}
		written = { to: held, bytes: FLAT };
		void simulate(held, 0);
		entry = setTimeout(() => {
			entry = undefined;
			const now = trainer();
			if (now) writeRoad(now, false);
		}, ROAD.entryFlatMs);
	}

	function toWatts(watts: number) {
		intent = { watts };
		written = undefined;
		void trainer()?.setTargetPower(watts);
	}

	/** Out of the sprint and off the road: the next flips again, and a pending grade never lands. */
	function release() {
		clearTimeout(entry);
		entry = undefined;
		sprinting = false;
	}

	return {
		/**
		 * The sprint, once per window. Slope has no usable range on a
		 * single-speed setup (Zwift Cog), so there it runs as a target nobody
		 * holds instead (#30/#41). Otherwise the hill, flat first out of ERG.
		 */
		sprint(setup: SprintSetup, ftp: number) {
			if (sprinting || !trainer()) return;
			sprinting = true;
			if (setup.singleSpeed) toWatts(ftp * 2);
			else toSim(sprintSlope(setup));
		},
		/** This second's felt grade from createRideGrade — roads only. */
		road(percent: number) {
			sprinting = false;
			toSim(percent);
		},
		/**
		 * Hold a target, or a flat road where there is none (#2658): zero in
		 * ERG is a freewheel. Letting go of the trainer — Stop, leaving —
		 * still writes ERG 0 W; nobody is riding it then.
		 */
		hold(watts: number) {
			release();
			if (watts > 0) toWatts(watts);
			else toSim(0);
		},
		/** A grade the rider chose — a free ride's slope, not a target to hold. */
		grade(percent: number) {
			release();
			toSim(percent);
		},
		release,
		/**
		 * One gear harder or easier, in SIM only (ERG routes Easier/Harder to
		 * the target, #3328). One composed write at once, exempt from the
		 * felt-grade slew and the drafting spacing; inside the entry flat it
		 * moves k only. False when nothing moved.
		 */
		shift(dir: 1 | -1): boolean {
			if (!gearsEnabled() || !intent || !('felt' in intent)) return false;
			const space = gearSpace(ratio.ratio, k);
			if (space.atEnd(dir)) return false;
			k = space.step(dir);
			const held = trainer();
			if (held && !entry) writeRoad(held, true);
			return true;
		},
		/** A trainer sample, for the drivetrain: the real ratio and the flywheel speed. */
		sample(sample: TrainerSample) {
			trackRatio(ratio, sample);
		},
		/** The hub's shelter, felt only while "Feel the draft" is on (ADR-0077). */
		shelter(value: number, feel: boolean) {
			shelter = value;
			draftOn = feel;
			if (intent && 'felt' in intent) toSim(intent.felt);
		},
		/** The link came back (#1846): the current state again, recomputed. */
		reissue() {
			const held = trainer();
			if (!held || !intent) return;
			clearTimeout(entry);
			entry = undefined;
			if ('watts' in intent) void held.setTargetPower(intent.watts);
			else writeRoad(held, true);
		},
		/**
		 * Whether this screen drives the trainer (#1853); the gear lives
		 * beside the grant. Losing it lets go. Getting it back starts the
		 * gear again at k = 1, says so (#3330), and writes afresh whatever
		 * this screen last sent — the screen that was driving may have left
		 * the trainer anywhere.
		 */
		grant(held: boolean): boolean {
			if (!held) {
				lost = true;
				release();
				return false;
			}
			if (lost) {
				lost = false;
				k = 1;
				written = undefined;
				onGearReset();
			}
			return true;
		},
		get gear() {
			return { k, label: gearSpace(ratio.ratio, k).label, clamp };
		},
	};
}
