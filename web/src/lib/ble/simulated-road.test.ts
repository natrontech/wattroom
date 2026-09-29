import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BikeKg,
	PaceDefaultCdA,
	ReferenceRiderKg,
	ReferenceRiderWatts,
} from '$lib/protocol';
import { createPace } from '$lib/road/pace';
import { goldenVector } from '$lib/road/golden.test-helper';
import { SimulatedTrainer } from './simulated';

/**
 * A road ridden on the SimulatedTrainer lands where the golden vectors say
 * (#3050): its samples go through the pace model second by second, the way
 * the dot will (ADR-0084), and the trainer's own speed is never read. The
 * route ride through the app proves the same on this trainer with #3027.
 */
describe('a road on the SimulatedTrainer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it.each([
		{ name: 'the reference rider from a standstill on the flat', grade: 0 },
		{ name: 'the reference rider up 8 %', grade: 8 },
	])(
		'$name covers the golden distance within a percent',
		async ({ name, grade }) => {
			const vector = goldenVector(name, PaceDefaultCdA);
			const [leg] = vector.legs;
			const trainer = new SimulatedTrainer({
				rng: () => 0.5,
				baseWatts: ReferenceRiderWatts,
			});
			const dot = createPace(vector.speed);
			trainer.onSample((s) =>
				dot.step(s.watts, grade, ReferenceRiderKg + BikeKg, PaceDefaultCdA, 0),
			);
			await trainer.connect();
			await trainer.setSimulation({ gradePct: grade });
			vi.advanceTimersByTime(leg.seconds * 1000);
			expect(Math.abs(dot.distance - leg.distance) / leg.distance).toBeLessThan(
				0.01,
			);
		},
	);
});
