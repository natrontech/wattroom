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

describe('simulate()', () => {
	it('holds every SIM write to MinTrainerGrade … MaxTrainerGrade', async () => {
		const trainer = new Recorder();
		await simulate(trainer, 30);
		await simulate(trainer, -20);
		await simulate(trainer, 3);
		expect(trainer.writes).toEqual(['sim:15', 'sim:-10', 'sim:3']);
	});
});
