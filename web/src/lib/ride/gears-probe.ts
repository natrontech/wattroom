import {
	resolveSim,
	type SimParams,
	type Trainer,
	type TrainerSample,
} from '$lib/ble/trainer';
import { composeSim, createActuator } from '$lib/ride/actuation.svelte';
import { ratioState, trackRatio } from '$lib/ride/drivetrain';
import { createShiftDriver, type ShiftDir } from '$lib/ride/shifter';

/**
 * The Gears probe (#3331, ADR-0084): what the virtual-gears prototype assumes
 * and only a trainer can answer, one step per button on /dev/hardware, run by
 * a person at the Kickr sitting with docs/HARDWARE-SESSIONS.md's checklist.
 * Every write that reaches the trainer is logged with the whole road, the
 * circumference, the gear and the time since the press — the log is the
 * deliverable. Runs against any Trainer, so it is proven on the
 * SimulatedTrainer before anyone sets up a Kickr.
 */

/** A trainer's wheel until told otherwise, mm — the 2.096 m ADR-0084 divides by. */
export const WHEEL_MM = 2096;
/** FTMS control point op codes, as the log names them. */
const OP = { erg: 0x05, sim: 0x11, circumference: 0x12 } as const;

export type StepId =
	| 'P1'
	| 'P2a'
	| 'P2b'
	| 'P4'
	| 'P5'
	| 'P6'
	| 'P7'
	| 'P8'
	| 'P9'
	| 'P10'
	| 'P11'
	| 'P12';

/** One line of the log: a write, a shift or a press, or a sample. */
export type ProbeEvent =
	| {
			kind: 'write';
			step: StepId;
			op: (typeof OP)[keyof typeof OP];
			grade: number;
			crr: number;
			cw: number;
			wind: number;
			circumference: number;
			k: number;
			watts?: number;
			ms: number;
	  }
	| { kind: 'shift'; step: StepId; k: number; ms: number }
	| { kind: 'press'; step: StepId; dir: ShiftDir; ms: number }
	| {
			kind: 'sample';
			step: StepId;
			watts: number;
			cadence: number;
			/** The real ratio the drivetrain has read so far (P1); the speed
			 *  itself is the drivetrain's alone, and the page logs it raw. */
			ratio: number | null;
			ms: number;
	  };

/** What a step can do: the writes it needs, and time. */
export interface Probe {
	/** A bare road, not composed: k is 1. */
	write(road: SimParams): Promise<void>;
	/** One composed write: a felt grade at gear k (ADR-0084's transform). */
	road(feltPct: number, k: number): Promise<void>;
	erg(watts: number): Promise<void>;
	circumference(mm: number): Promise<void>;
	/** A shift to k at the current felt grade: one composed write, marked. */
	shift(k: number): Promise<void>;
	/** The ride's own actuator in SIM at a felt grade, for presses to shift. */
	ride(feltPct: number): void;
	/** Harder or Easier through the ride's own shifter and actuator. */
	press(dir: ShiftDir): void;
	hold(seconds: number): Promise<void>;
	/** The real ratio the drivetrain has read so far, or null. */
	readonly ratio: number | null;
}

export interface ProbeStep {
	id: StepId;
	title: string;
	/** What the rider does while it runs, in one line. */
	how: string;
	/** Absent for P7, which reads P6's log rather than riding. */
	run?: (probe: Probe) => Promise<void>;
}

/**
 * One step, run against `trainer`, every write and sample into `log`. The
 * trainer is wrapped, so what is logged is exactly what the trainer was
 * asked — the actuator's writes included (P8, P10).
 */
export async function runProbeStep(
	step: ProbeStep,
	trainer: Trainer,
	log: (event: ProbeEvent) => void,
	{
		now = () => Date.now(),
		sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
	}: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
	if (!step.run) return;
	const pressed = now();
	const ms = () => now() - pressed;
	let road = resolveSim({ gradePct: 0 });
	let felt = 0;
	let k = 1;
	// While the actuator drives (P8, P10), its gear is the one written.
	let riding = false;
	let circumference = WHEEL_MM;
	const ratio = ratioState();

	function written(op: (typeof OP)[keyof typeof OP], watts?: number) {
		log({
			kind: 'write',
			step: step.id,
			op,
			grade: road.gradePct,
			crr: road.crr,
			cw: road.cw,
			wind: road.windMps,
			circumference,
			k: riding ? actuator.gear.k : k,
			watts,
			ms: ms(),
		});
	}

	const logged: Trainer = {
		get name() {
			return trainer.name;
		},
		get status() {
			return trainer.status;
		},
		get mode() {
			return trainer.mode;
		},
		connect: () => trainer.connect(),
		disconnect: () => trainer.disconnect(),
		onSample: (cb) => trainer.onSample(cb),
		onStatus: (cb) => trainer.onStatus(cb),
		setTargetPower(watts) {
			written(OP.erg, watts);
			return trainer.setTargetPower(watts);
		},
		setSimulation(next) {
			road = resolveSim(next);
			written(OP.sim);
			return trainer.setSimulation(next);
		},
	};

	// The ride's own path for presses: the actuator, in SIM at the step's
	// felt grade, behind the shifter every input goes through.
	const actuator = createActuator(() => logged);
	const shifter = createShiftDriver(
		(event) => {
			if (event.kind === 'shift') actuator.shift(event.dir);
		},
		(dir) => actuator.atEnd(dir),
		now,
	);

	const off = trainer.onSample((sample: TrainerSample) => {
		trackRatio(ratio, sample);
		log({
			kind: 'sample',
			step: step.id,
			watts: sample.watts,
			cadence: sample.cadence,
			ratio: ratio.ratio,
			ms: ms(),
		});
	});

	const probe: Probe = {
		write: (next) => {
			k = 1;
			return logged.setSimulation(next);
		},
		road: (feltPct, gear) => {
			felt = feltPct;
			k = gear;
			return logged.setSimulation(composeSim({ feltPct }, 0, gear, false).road);
		},
		ride(feltPct) {
			riding = true;
			actuator.grade(feltPct);
		},
		erg: (watts) => logged.setTargetPower(watts),
		async circumference(mm) {
			circumference = mm;
			written(OP.circumference);
			await trainer.setWheelCircumference?.(mm);
		},
		shift(next) {
			k = next;
			log({ kind: 'shift', step: step.id, k, ms: ms() });
			return logged.setSimulation(
				composeSim({ feltPct: felt }, 0, k, false).road,
			);
		},
		press(dir) {
			log({ kind: 'press', step: step.id, dir, ms: ms() });
			shifter.press(dir, 'probe');
			shifter.release('probe');
		},
		hold: (seconds) => sleep(seconds * 1000),
		get ratio() {
			return ratio.ratio;
		},
	};

	try {
		await step.run(probe);
	} finally {
		off();
		shifter.stop();
		actuator.release();
	}
}

/** P7: how many 0x11 writes each shift of a P6 log carried — one each, by ADR-0084. */
export function writesPerShift(events: readonly ProbeEvent[]): number[] {
	const counts: number[] = [];
	for (const event of events) {
		if (event.kind === 'shift') counts.push(0);
		else if (event.kind === 'write' && event.op === OP.sim && counts.length > 0)
			counts[counts.length - 1]++;
	}
	return counts;
}
