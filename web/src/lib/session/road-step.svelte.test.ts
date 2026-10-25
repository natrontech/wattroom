// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { SimulatedTrainer } from '$lib/ble/simulated';
import { flatten } from '$lib/workout/engine';
import { createRide } from './ride.svelte';
import { createRecording } from './recording.svelte';
import type { RideDeps } from './ride-deps';

vi.mock('$lib/sound/cues', () => ({ play: () => {} }));
afterEach(() => vi.useRealTimers());
const settle = async () => {
	await Promise.resolve();
	flushSync();
};

it('rides a joined road block at the shared felt grade and returns to ERG', async () => {
	vi.useFakeTimers();
	let elapsed = $state(0);
	let joined = $state(true);
	const road = {
		length: 2000,
		heights: Array.from({ length: 101 }, (_, i) => 100 + 0.8 * i),
		turns: Array<number>(100).fill(0),
	};
	const segments = flatten({
		name: 'Road steps',
		steps: [
			{ type: 'steady', seconds: 5, target: 0.8 },
			{ type: 'road', seconds: 10 },
			{ type: 'steady', seconds: 5, target: 0.6 },
		],
	});
	const deps: RideDeps = {
		live: { tick: null, sendMetrics() {}, finish() {} },
		profile: {
			current: { ftp: 250, shareHr: false, singleSpeed: false, sprintGrade: 5 },
		},
		recording: createRecording({ ftp: () => 250 }),
		myId: () => 'me',
		shared: () => ({ phase: 'running', elapsed }),
		joined: () => joined,
		segments: () => segments,
		road: () => ({ road, m: 500, mps: 8, at: Date.now(), loop: false }),
		free: {
			armed: false,
			mode: 'grade',
			grade: 0,
			watts: 100,
			targetWatts: 0,
			road: null,
			second() {},
			nudge() {},
		},
	};
	let ride!: ReturnType<typeof createRide>;
	const dispose = $effect.root(() => {
		ride = createRide(deps);
	});
	const trainer = new SimulatedTrainer({ replay: [] });
	try {
		await ride.ride(trainer);
		await settle();
		expect(trainer.writes.at(-1)).toMatchObject({ op: 'erg', watts: 200 });
		elapsed = 5;
		await settle();
		expect(trainer.writes.at(-1)).toMatchObject({ op: 'sim', gradePct: 0 });
		await vi.advanceTimersByTimeAsync(1000);
		await settle();
		expect(trainer.road.gradePct).toBeCloseTo(2);
		expect(ride.target).toBe(0);
		joined = false;
		await settle();
		expect(trainer.road.gradePct).toBe(0);
		joined = true;
		elapsed = 15;
		await settle();
		expect(trainer.writes.at(-1)).toMatchObject({ op: 'erg', watts: 150 });
	} finally {
		ride.unpair();
		dispose();
	}
});
