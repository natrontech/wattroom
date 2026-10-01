// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploads: { routeId?: string; drive?: string; samples: unknown[] }[] = [];
vi.mock('$lib/ride/save', () => ({
	uploadRide: vi.fn(async (ride: (typeof uploads)[number]) => {
		uploads.push(ride);
		return { saved: { id: 'r1' } };
	}),
}));
vi.mock('$lib/ride/buffer', () => ({
	openRideBuffer: vi.fn(async () => ({
		crashSafe: true,
		append() {},
		end() {},
		release() {},
		since: async () => [],
	})),
}));

import { SimulatedTrainer } from '$lib/ble/simulated';
import { createFreeRide } from './free-ride.svelte';
import { ergByRoad } from './ride-grade';
import type { RideableRoute } from './roads';
import { createSoloRoadRide } from './solo-road.svelte';

// A hand-written road, 3 km at a steady 4 % — nobody's route (#3054).
const climb: RideableRoute = {
	id: 'route-1',
	name: 'Test climb',
	road: {
		length: 3000,
		heights: Array.from({ length: 151 }, (_, i) => 100 + 0.8 * i),
		turns: Array<number>(150).fill(0),
	},
};

describe('a free ride on a road, alone at /ride?road= (#3027)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		uploads.length = 0;
	});
	afterEach(() => vi.useRealTimers());

	async function riding(mode: 'grade' | 'watts') {
		const trainer = new SimulatedTrainer({ baseWatts: 200, rng: () => 0.5 });
		await trainer.connect();
		let free!: ReturnType<typeof createFreeRide>;
		let solo!: ReturnType<typeof createSoloRoadRide>;
		const dispose = $effect.root(() => {
			free = createFreeRide({ ftp: () => 250, kg: () => 75 });
			free.setMode(mode);
			solo = createSoloRoadRide({ free, route: climb });
		});
		solo.start(trainer);
		return { trainer, free, solo, dispose };
	}

	it('rides the road’s felt grade, and moves along it', async () => {
		const { trainer, free, solo, dispose } = await riding('grade');
		await vi.advanceTimersByTimeAsync(90_000);
		const sims = trainer.writes.flatMap((w) =>
			w.op === 'sim' ? [w.gradePct] : [],
		);
		// The flat out of ERG first, then 4 % felt at half (docs/SPEC.md).
		expect(sims[0]).toBe(0);
		expect(sims.at(-1)).toBeCloseTo(2, 6);
		expect(free.road!.m).toBeGreaterThan(100);
		expect(free.seconds).toBeGreaterThan(60);
		await solo.end();
		expect(uploads[0].routeId).toBe('route-1');
		expect(trainer.status).toBe('disconnected');
		dispose();
	});

	it('holds ERG by the road in watts mode', async () => {
		const { trainer, solo, dispose } = await riding('watts');
		await vi.advanceTimersByTimeAsync(10_000);
		const ergs = trainer.writes.flatMap((w) =>
			w.op === 'erg' ? [w.watts] : [],
		);
		expect(ergs.at(-1)).toBe(ergByRoad(250, 4));
		await solo.end();
		expect(uploads).toHaveLength(0); // under the minute: nothing to save
		dispose();
	});
});
