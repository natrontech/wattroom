import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	ControlMode,
	SimParams,
	Trainer,
	TrainerSample,
	TrainerStatus,
} from '$lib/ble/trainer';
import { createActuator, simulate } from './actuation';

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
