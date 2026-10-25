import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BikeKg,
	MaxTrainerGrade,
	MinTrainerGrade,
	PaceDefaultCdA,
	ReferenceRiderKg,
	ReferenceRiderWatts,
} from '$lib/protocol';
import { createPace } from '$lib/road/pace';
import { goldenVector } from '$lib/road/golden.test-helper';
import { encodeSimulation } from './ftms';
import { SimulatedTrainer } from './simulated';
import { trainerForce } from './trainer';

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

/**
 * The trainer's road is the dot's (#3351, docs/SPEC.md "Route rides"): FTMS's
 * Cw read as FE-C's ρ·CdA, at the pace model's one CdA, off the wire as a
 * trainer decodes it.
 */
describe('the default road on the SimulatedTrainer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const decoded = (gradePct: number) => {
		const view = new DataView(encodeSimulation({ gradePct }));
		return {
			windMps: view.getInt16(1, true) / 1000,
			gradePct: view.getInt16(3, true) / 100,
			crr: view.getUint8(5) / 10000,
			cw: view.getUint8(6) / 100,
		};
	};

	it("spins the flywheel at the dot's own flat speed for the reference rider", async () => {
		const [leg] = goldenVector(
			'the reference rider from a standstill on the flat',
			PaceDefaultCdA,
		).legs;
		const trainer = new SimulatedTrainer({
			rng: () => 0.5,
			baseWatts: ReferenceRiderWatts,
		});
		let speed = 0;
		trainer.onSample((s) => (speed = s.speedMps!));
		await trainer.connect();
		await trainer.setSimulation(decoded(0));
		vi.advanceTimersByTime(leg.seconds * 1000);
		// Read as ½·ρ·CdA, with Cw·v² as drag, 0.39 kg/m holds it at 28 km/h.
		expect(Math.abs(speed / leg.speed - 1)).toBeLessThan(0.005);
	});

	it('sits inside the range Wahoo publishes for the Kickr Core, −10 … +16 %', () => {
		expect(MinTrainerGrade).toBe(-10);
		expect(MaxTrainerGrade).toBeLessThanOrEqual(16);
	});

	// A Kickr Core brakes and never drives: past the grade where its road
	// force reaches zero it renders its own floor, whatever the write says.
	it('asks a brake-only trainer for nothing to brake at MinTrainerGrade below 70 km/h', async () => {
		const floor = { ...decoded(MinTrainerGrade), gradePct: MinTrainerGrade };
		for (let kph = 0; kph <= 70; kph++)
			expect(
				trainerForce(floor, ReferenceRiderKg + BikeKg, kph / 3.6),
			).toBeLessThan(0);
		// 53×11 at 110 rpm, the fastest flywheel a real gear turns: 67 km/h.
		const trainer = new SimulatedTrainer({
			rng: () => 0.5,
			cadence: 110,
			ratio: { chainring: 53, cog: 11 },
		});
		let watts = -1;
		trainer.onSample((s) => (watts = s.watts));
		await trainer.connect();
		await trainer.setSimulation(floor);
		vi.advanceTimersByTime(30_000);
		expect(watts).toBe(0);
	});
});
