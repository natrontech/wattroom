import { afterEach, expect, it, vi } from 'vitest';
vi.mock('$lib/hud/feed', () => ({ publishHud: () => {} }));
import { SimulatedTrainer } from '$lib/ble/simulated';
import { packRoad } from '$lib/road/road';
import { ROAD } from '$lib/ride/ride-grade';
import { createRideSession } from './session.svelte';
import { COUNTDOWN_SECONDS } from './ride-state';
import type { Workout } from './types';

const workout: Workout = {
	name: 'Road steps',
	steps: [
		{ type: 'steady', seconds: 5, target: 0.8 },
		{ type: 'road', seconds: 10, fromM: 500 },
		{ type: 'road', seconds: 10 },
		{ type: 'steady', seconds: 5, target: 0.6 },
	],
	road: {
		routeId: '00000000-0000-0000-0000-000000000001',
		fromM: 100,
		toM: 2100,
		originM: 100,
		profile: btoa(
			String.fromCharCode(
				...packRoad({
					length: 2000,
					heights: Array.from({ length: 101 }, (_, i) => 100 + 0.8 * i),
					turns: Array<number>(100).fill(0),
				}),
			),
		),
	},
};
afterEach(() => vi.useRealTimers());

it('rides road steps at the felt grade, carries the dot and returns to ERG', async () => {
	vi.useFakeTimers();
	const trainer = new SimulatedTrainer({ replay: [] });
	const ride = createRideSession({ trainer, workout, ftp: 250, kg: () => 75 });
	try {
		await ride.start();
		expect(trainer.writes).toEqual([]);
		ride.tick(COUNTDOWN_SECONDS);
		expect(trainer.writes.at(-1)).toMatchObject({ op: 'erg', watts: 200 });
		ride.skip();
		expect(ride.road!.m).toBe(500);
		expect(ride.info.targetWatts).toBeNull();
		expect(trainer.writes.at(-1)).toMatchObject({ op: 'sim', gradePct: 0 });
		ride.onSample({ watts: 300, cadence: 90, at: 1000 });
		ride.tick();
		await vi.advanceTimersByTimeAsync(ROAD.entryFlatMs);
		expect(trainer.mode).toBe('sim');
		expect(trainer.road.gradePct).toBeGreaterThan(0);
		expect(trainer.road.gradePct).toBeLessThanOrEqual(2);
		expect(ride.scored).toBe(false);
		const before = ride.road!.m;
		ride.skip();
		expect(ride.road!.m).toBe(before);
		ride.onSample({ watts: 300, cadence: 90, at: 2000 });
		ride.tick();
		expect(ride.road!.m).toBeGreaterThan(before);
		expect(trainer.road.gradePct).toBeCloseTo(2);
		expect(ride.scored).toBe(false);
		ride.pause();
		expect(trainer.road.gradePct).toBe(0);
	} finally {
		ride.stop();
	}
});

it('returns to ERG at the following targeted block', async () => {
	vi.useFakeTimers();
	const trainer = new SimulatedTrainer({ replay: [] });
	const ride = createRideSession({ trainer, workout, ftp: 250, kg: () => 75 });
	try {
		await ride.start();
		ride.tick(COUNTDOWN_SECONDS);
		ride.skip();
		ride.skip();
		ride.skip();
		expect(trainer.writes.at(-1)).toMatchObject({ op: 'erg', watts: 150 });
		await vi.advanceTimersByTimeAsync(ROAD.entryFlatMs);
		expect(trainer.mode).toBe('erg');
	} finally {
		ride.stop();
	}
});

it('runs an all-road workout for its written seconds without scoring it', async () => {
	vi.useFakeTimers();
	const trainer = new SimulatedTrainer({ replay: [] });
	const ride = createRideSession({
		trainer,
		workout: { ...workout, steps: [{ type: 'road', seconds: 10 }] },
		ftp: 250,
		kg: () => 75,
	});
	try {
		await ride.start();
		ride.tick(COUNTDOWN_SECONDS);
		for (let s = 0; s < 10; s++) {
			expect(ride.state).toBe('running');
			expect(ride.info.targetWatts).toBeNull();
			ride.onSample({ watts: 300, cadence: 90, at: s * 1000 });
			ride.tick();
		}
		expect(ride.state).toBe('done');
		expect(ride.elapsed).toBe(10);
		expect(ride.scored).toBe(false);
		expect(ride.road!.m).toBeGreaterThan(workout.road!.fromM);
	} finally {
		ride.stop();
	}
});
