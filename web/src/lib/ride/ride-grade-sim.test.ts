import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BikeKg,
	MaxTrainerGrade,
	MinTrainerGrade,
	PaceDefaultCdA,
	ReferenceRiderKg,
} from '$lib/protocol';
import { SimulatedTrainer } from '$lib/ble/simulated';
import { at } from '$lib/road/along';
import { createPace } from '$lib/road/pace';
import { createActuator } from './actuation.svelte';
import { createRideGrade, feltGrade, ROAD } from './ride-grade';
import { gradedRoad, stretch } from './road.test-helper';

/**
 * rideGrade() proven on the SimulatedTrainer (#3025): a road ridden the way
 * the route ride will ride it — the dot moved by the pace model from the
 * trainer's watts, the trainer told the felt grade a second ahead — and the
 * writes that reach the trainer held to SPEC's rules.
 */
describe('a road ridden on the SimulatedTrainer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('gets one flat on entry, then felt grades in range, slewed at most 1 %/s', async () => {
		const road = gradedRoad([
			...stretch(0, 300),
			...stretch(9, 800),
			...stretch(-12, 1200),
			...stretch(0, 300),
		]);
		const trainer = new SimulatedTrainer({ rng: () => 0.5, baseWatts: 250 });
		const act = createActuator(() => trainer);
		const grade = createRideGrade();
		const dot = createPace();
		trainer.onSample((s) => {
			dot.step(
				s.watts,
				at(road, dot.distance).grade,
				ReferenceRiderKg + BikeKg,
				PaceDefaultCdA,
				0,
			);
			act.road(grade.at(road, dot.distance, dot.speed));
		});
		await trainer.connect();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(dot.distance).toBeGreaterThan(road.length);

		const sims = trainer.writes.flatMap((w) =>
			w.op === 'sim' ? [w.gradePct] : [],
		);
		// Out of the trainer's first ERG: flat once, and never ERG again.
		expect(sims[0]).toBe(0);
		expect(trainer.writes.some((w) => w.op === 'erg')).toBe(false);
		for (const g of sims) {
			expect(g).toBeGreaterThanOrEqual(MinTrainerGrade);
			expect(g).toBeLessThanOrEqual(MaxTrainerGrade);
		}
		for (let i = 2; i < sims.length; i++)
			expect(Math.abs(sims[i] - sims[i - 1])).toBeLessThanOrEqual(
				ROAD.slewPerSecond + 1e-9,
			);
		// The climb is felt at half, the descent at a quarter and floored.
		expect(Math.max(...sims)).toBeCloseTo(feltGrade(9), 9);
		expect(Math.min(...sims)).toBeCloseTo(feltGrade(-12), 9);
	});
});
