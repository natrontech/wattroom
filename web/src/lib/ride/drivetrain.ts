import {
	resolveSim,
	type SimParams,
	type TrainerSample,
} from '$lib/ble/trainer';
import {
	BikeKg,
	MaxTrainerGrade,
	MinTrainerGrade,
	PaceGravity,
	ReferenceRiderKg,
} from '$lib/protocol';

/**
 * The virtual drivetrain (#3325, ADR-0084): a gear is k = virtual ratio ÷
 * real ratio, applied to the road every SIM write carries. Pure: no Svelte,
 * no Web Bluetooth. The only reader of TrainerSample.speedMps — the dot,
 * timing and the bike computer never read the trainer's speed.
 */

/** docs/SPEC.md "Virtual gears" (defaults — tune in alpha), one line each. */
export const GEARS = {
	/** "The gear table": 24 gears, geometric from 0.72 to 5.30. */
	count: 24,
	lowest: 0.72,
	highest: 5.3,
	/** "A shift", with no real ratio known: k steps by ×1.0907… */
	blindStep: 1.0907,
	/** …bounded to 0.30 … 2.2. */
	blindMin: 0.3,
	blindMax: 2.2,
} as const;

export const REAL_RATIO = {
	/** "Real ratio": trainer speed ÷ (cadence × 2.096 m)… */
	wheelMetres: 2.096,
	/** …the median over the last 7 samples… */
	window: 7,
	/** …at 60–110 rpm. */
	minRpm: 60,
	maxRpm: 110,
	/** A real shift: the median ≥ 5 % from the current ratio… */
	shiftShare: 0.05,
	/** …on 3 consecutive samples. */
	shiftSamples: 3,
	/** The reference refines — their mean — from at most 30 in-band samples since the last real shift. */
	refine: 30,
} as const;

/** "Write range": a Cw above the UINT8 field folds into grade (the FTMS width, 0.01 kg/m). */
const MAX_CW = 2.55;
/**
 * The mass a trainer is assumed to simulate, for folding Cw into grade:
 * m/m_t is 1 (SPEC), and until its own issue decides otherwise the reference
 * rider on the reference bike stands in for m.
 */
const TRAINER_MASS = ReferenceRiderKg + BikeKg;

/** The gear table, easiest first: gear n is GEAR_RATIOS[n − 1]. */
export const GEAR_RATIOS: readonly number[] = Array.from(
	{ length: GEARS.count },
	(_, i) =>
		GEARS.lowest * (GEARS.highest / GEARS.lowest) ** (i / (GEARS.count - 1)),
);

/** The table gear (1-based) nearest a ratio, by ratio rather than by difference. */
function nearestGear(ratio: number): number {
	let best = 1;
	for (let n = 2; n <= GEARS.count; n++)
		if (
			Math.abs(Math.log(ratio / GEAR_RATIOS[n - 1])) <
			Math.abs(Math.log(ratio / GEAR_RATIOS[best - 1]))
		)
			best = n;
	return best;
}

export interface GearSpace {
	/** What the gear field reads: "Gear 15", or "+3" with no real ratio. */
	label: string;
	/** The table gear shown, or null with no real ratio. */
	gear: number | null;
	/** Nothing to move to this way: the shifter's end. */
	atEnd(dir: 1 | -1): boolean;
	/** k after one shift this way; k itself at an end. */
	step(dir: 1 | -1): number;
}

/**
 * Where a rider's gear stands and where a shift takes it. With a real ratio,
 * the label is the table gear nearest k × ratio and a shift goes to that
 * gear's neighbour, so the label always moves. With none, k steps by a
 * fixed factor and the label counts steps from the real gear.
 */
export function gearSpace(realRatio: number | null, k: number): GearSpace {
	if (realRatio !== null) {
		const gear = nearestGear(k * realRatio);
		const to = (dir: 1 | -1) => gear + dir;
		const atEnd = (dir: 1 | -1) => to(dir) < 1 || to(dir) > GEARS.count;
		return {
			label: `Gear ${gear}`,
			gear,
			atEnd,
			step: (dir) => (atEnd(dir) ? k : GEAR_RATIOS[to(dir) - 1] / realRatio),
		};
	}
	const n = Math.round(Math.log(k) / Math.log(GEARS.blindStep));
	const next = (dir: 1 | -1) => k * GEARS.blindStep ** dir;
	const atEnd = (dir: 1 | -1) =>
		next(dir) > GEARS.blindMax + 1e-9 || next(dir) < GEARS.blindMin - 1e-9;
	return {
		label: n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0',
		gear: null,
		atEnd,
		step: (dir) => (atEnd(dir) ? k : next(dir)),
	};
}

export interface RatioState {
	/** Off for a trainer whose ratio moves with grade (hardware check P1). */
	detect: boolean;
	/** The real ratio, once 7 in-band samples have agreed on one. */
	ratio: number | null;
	window: number[];
	refine: number[];
	strikes: number;
}

export function ratioState(detect = true): RatioState {
	return { detect, ratio: null, window: [], refine: [], strikes: 0 };
}

const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * One trainer sample into the real-ratio detector. True when the rider moved
 * their real derailleur: the ratio re-anchors and k stays, so the virtual
 * gear rides on top of the real one and only the label moves.
 */
export function trackRatio(state: RatioState, sample: TrainerSample): boolean {
	const { speedMps, cadence } = sample;
	if (!state.detect || speedMps === undefined) return false;
	if (cadence < REAL_RATIO.minRpm || cadence > REAL_RATIO.maxRpm) return false;
	const r = speedMps / ((cadence / 60) * REAL_RATIO.wheelMetres);
	state.window = [...state.window, r].slice(-REAL_RATIO.window);
	if (state.window.length < REAL_RATIO.window) return false;
	const m = median(state.window);
	if (state.ratio === null) {
		state.ratio = m;
		state.refine = [...state.window];
		return false;
	}
	if (Math.abs(m / state.ratio - 1) >= REAL_RATIO.shiftShare) {
		if (++state.strikes < REAL_RATIO.shiftSamples) return false;
		state.ratio = m;
		state.refine = [m];
		state.strikes = 0;
		return true;
	}
	state.strikes = 0;
	state.refine = [...state.refine, r].slice(-REAL_RATIO.refine);
	state.ratio = state.refine.reduce((a, b) => a + b, 0) / state.refine.length;
	return false;
}

export type Clamp = 'grade-max' | 'grade-min' | null;

/**
 * The felt road at gear k (ADR-0084, SPEC "The transform"): what one SIM
 * write carries so the trainer resists with k·F(k·v) at its own flywheel
 * speed v —
 *
 *   sin θ' = k · sin θ,  Crr'·cos θ' = k · Crr · cos θ,
 *   Cw' = k³ · Cw · (1 − shelter),  wind' = wind ÷ k.
 *
 * A Cw past the UINT8 field folds its excess into grade at `vFwLast`, the
 * last flywheel speed, and the grade is clamped to the write range; the
 * clamp is reported so the ride can say so.
 */
export function simTransform(
	felt: SimParams,
	shelter: number,
	k: number,
	vFwLast: number,
): { road: Required<SimParams>; clamp: Clamp } {
	const road = resolveSim(felt);
	const theta = Math.atan(road.gradePct / 100);
	const windMps = road.windMps / k;
	let cw = k ** 3 * road.cw * (1 - shelter);
	let sin = k * Math.sin(theta);
	if (cw > MAX_CW) {
		const air = vFwLast + windMps;
		sin += ((cw - MAX_CW) * air * Math.abs(air)) / (TRAINER_MASS * PaceGravity);
		cw = MAX_CW;
	}
	sin = Math.max(-0.999, Math.min(0.999, sin));
	let gradePct = (100 * sin) / Math.sqrt(1 - sin * sin);
	let clamp: Clamp = null;
	if (gradePct > MaxTrainerGrade) {
		gradePct = MaxTrainerGrade;
		clamp = 'grade-max';
	} else if (gradePct < MinTrainerGrade) {
		gradePct = MinTrainerGrade;
		clamp = 'grade-min';
	}
	// Against the angle actually written, so the rolling term stays k × Crr.
	const written = Math.cos(Math.atan(gradePct / 100));
	const crr = (k * road.crr * Math.cos(theta)) / written;
	return { road: { gradePct, crr, cw, windMps }, clamp };
}
