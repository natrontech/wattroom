import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	ControlMode,
	SimParams,
	Trainer,
	TrainerSample,
	TrainerStatus,
} from '$lib/ble/trainer';
import { DEFAULTS, nudgedBias } from '$lib/workout/guards';
import { createActuator, simulate } from './actuation.svelte';
import { EASIER_HARDER_OFF, ergPress } from './easier-harder';
import { nudged } from './free-ride.svelte';

/** A trainer that remembers every write and switches mode as a real one does. */
class Recorder implements Trainer {
	name = 'recorder';
	status: TrainerStatus = 'connected';
	mode: ControlMode = 'erg';
	writes: string[] = [];
	/** Refuse SIM writes, as a control point that times out or answers 0x05. */
	refuse = false;
	async connect() {}
	async disconnect() {}
	async setTargetPower(watts: number) {
		this.mode = 'erg';
		this.writes.push(`erg:${watts}`);
	}
	async setSimulation(road: SimParams) {
		this.mode = 'sim';
		// At FTMS resolution: a composed grade is 4.000000000000001 on the way.
		this.writes.push(`sim:${Math.round(road.gradePct * 100) / 100}`);
		if (this.refuse) throw new Error('FTMS control point timed out');
	}
	onSample(_: (s: TrainerSample) => void) {
		return () => {};
	}
	onStatus(_: (s: TrainerStatus) => void) {
		return () => {};
	}
}

describe('the actuator', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('writes flat first only on entering SIM from ERG', async () => {
		const trainer = new Recorder();
		const act = createActuator(() => trainer);
		act.road(4);
		expect(trainer.writes).toEqual(['sim:0']);
		await vi.advanceTimersByTimeAsync(500);
		expect(trainer.writes).toEqual(['sim:0', 'sim:4']);
		// Already in SIM: no flat.
		act.road(5);
		expect(trainer.writes).toEqual(['sim:0', 'sim:4', 'sim:5']);
	});

	it('lands the grade asked for inside the flat, read when it ends', async () => {
		const trainer = new Recorder();
		const act = createActuator(() => trainer);
		act.road(4);
		await vi.advanceTimersByTimeAsync(200);
		act.road(4.5);
		await vi.advanceTimersByTimeAsync(300);
		expect(trainer.writes).toEqual(['sim:0', 'sim:4.5']);
	});

	it('never lands a grade after a release inside the flat', async () => {
		const trainer = new Recorder();
		const act = createActuator(() => trainer);
		act.road(4);
		act.release();
		await vi.advanceTimersByTimeAsync(1000);
		expect(trainer.writes).toEqual(['sim:0']);
	});

	it('gives a sprint from SIM its hill at once', async () => {
		const trainer = new Recorder();
		const act = createActuator(() => trainer);
		act.road(2);
		await vi.advanceTimersByTimeAsync(500);
		act.sprint({ grade: 6, singleSpeed: false }, 250);
		expect(trainer.writes).toEqual(['sim:0', 'sim:2', 'sim:6']);
	});
});

// #3515: the dedupe marked a SIM write held before it landed, so a write
// the trainer refused was never tried again while the road stayed the same —
// the spiral guard's release could sit unwritten for its whole ten seconds.
describe('a SIM write that fails', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('is written again by the next hold, the entry flat included', async () => {
		const trainer = new Recorder();
		trainer.refuse = true;
		const act = createActuator(() => trainer);
		act.hold(0);
		// The flat's own timed write is the first retry, and is refused too.
		await vi.advanceTimersByTimeAsync(500);
		expect(trainer.writes).toEqual(['sim:0', 'sim:0']);
		trainer.refuse = false;
		act.hold(0);
		expect(trainer.writes).toEqual(['sim:0', 'sim:0', 'sim:0']);
	});

	it('is written again by the next hold of the same road', async () => {
		const trainer = new Recorder();
		trainer.mode = 'sim';
		const act = createActuator(() => trainer);
		trainer.refuse = true;
		act.road(4);
		await vi.advanceTimersByTimeAsync(0);
		trainer.refuse = false;
		act.road(4);
		expect(trainer.writes).toEqual(['sim:4', 'sim:4']);
	});

	it('is forgotten only while it is still the last write', async () => {
		const trainer = new Recorder();
		trainer.mode = 'sim';
		const act = createActuator(() => trainer);
		trainer.refuse = true;
		act.road(4);
		trainer.refuse = false;
		act.road(5);
		await vi.advanceTimersByTimeAsync(0);
		act.road(5);
		expect(trainer.writes).toEqual(['sim:4', 'sim:5']);
	});
});

// #3515: a screen that lost the trainer to another of the rider's screens
// (#1853) still wrote a shift or a new shelter to it.
describe('a lost grant', () => {
	it('writes neither a shift nor a shelter', () => {
		const trainer = new Recorder();
		trainer.mode = 'sim';
		const act = createActuator(() => trainer);
		act.grade(4);
		act.grant(false);
		expect(act.shift(1)).toBe(false);
		act.shelter(0.3, true);
		expect(trainer.writes).toEqual(['sim:4']);
	});
});

describe('simulate()', () => {
	it('holds every SIM write to MinTrainerGrade … MaxTrainerGrade', async () => {
		const trainer = new Recorder();
		await simulate(trainer, 30);
		await simulate(trainer, -20);
		await simulate(trainer, 3);
		expect(trainer.writes).toEqual(['sim:15', 'sim:-10', 'sim:3']);
	});
});

// Jan, 2026-09-28 (ADR-0084): one pair of controls in every mode — a gear in
// SIM, a workout's bias or the free ride's watts in ERG, and nothing, with a
// hint, anywhere else.
describe('Easier / Harder (#3328)', () => {
	/** A value a press moves, by the rule that moves it. */
	function held(start: number, step: (value: number, dir: 1 | -1) => number) {
		let value = start;
		return {
			get value() {
				return value;
			},
			press: ergPress(
				() => value,
				(dir) => (value = step(value, dir)),
			),
		};
	}
	const bias = (start: number) =>
		held(start, (b, dir) => nudgedBias(b, dir * DEFAULTS.biasStep));
	const watts = (start: number) =>
		held(start, (w, dir) => nudged('watts', w, dir));

	type Ride = 'sim' | 'erg' | 'no trainer' | 'lost' | 'not started';
	const table: {
		ride: Ride;
		erg?: ReturnType<typeof held>;
		dir: 1 | -1;
		answer: object;
		after?: number;
	}[] = [
		{ ride: 'sim', dir: 1, answer: { moved: true } },
		{ ride: 'sim', dir: -1, answer: { moved: true } },
		{ ride: 'erg', erg: bias(1), dir: 1, answer: { moved: true }, after: 1.01 },
		{
			ride: 'erg',
			erg: bias(1),
			dir: -1,
			answer: { moved: true },
			after: 0.99,
		},
		{
			ride: 'erg',
			erg: bias(1.2),
			dir: 1,
			answer: { moved: false },
			after: 1.2,
		},
		{
			ride: 'erg',
			erg: bias(0.8),
			dir: -1,
			answer: { moved: false },
			after: 0.8,
		},
		{
			ride: 'erg',
			erg: watts(200),
			dir: 1,
			answer: { moved: true },
			after: 210,
		},
		{
			ride: 'erg',
			erg: watts(200),
			dir: -1,
			answer: { moved: true },
			after: 190,
		},
		{
			ride: 'erg',
			erg: watts(1000),
			dir: 1,
			answer: { moved: false },
			after: 1000,
		},
		{
			ride: 'erg',
			erg: watts(50),
			dir: -1,
			answer: { moved: false },
			after: 50,
		},
		{ ride: 'erg', dir: 1, answer: { disabled: EASIER_HARDER_OFF.fixed } },
		{
			ride: 'no trainer',
			dir: 1,
			answer: { disabled: EASIER_HARDER_OFF.noTrainer },
		},
		{ ride: 'lost', dir: -1, answer: { disabled: EASIER_HARDER_OFF.lost } },
		{
			ride: 'not started',
			dir: 1,
			answer: { disabled: EASIER_HARDER_OFF.idle },
		},
	];

	it.each(table)(
		'$ride, $dir: $answer',
		({ ride, erg, dir, answer, after }) => {
			const trainer = new Recorder();
			const act = createActuator(() =>
				ride === 'no trainer' ? null : trainer,
			);
			if (ride === 'sim') act.grade(4);
			if (ride === 'erg' || ride === 'lost') act.hold(200);
			if (ride === 'lost') act.grant(false);
			expect(act.easierHarder(dir, erg?.press)).toEqual(answer);
			if (after !== undefined) expect(erg?.value).toBe(after);
			// A gear moves in SIM alone: an ERG press never changes k.
			expect(Math.sign(act.gear.k - 1)).toBe(ride === 'sim' ? dir : 0);
		},
	);
});
