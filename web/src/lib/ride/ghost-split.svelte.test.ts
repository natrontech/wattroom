// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('$lib/api', () => ({ api: (...args: unknown[]) => api(...args) }));

import type { FreeRide } from './free-ride.svelte';
import { createGhostSplit } from './ghost-split.svelte';

type Road = { id: string; m: number; lap: number; borrowed: boolean };

/** Just the free ride the split reads, reactive as the real one is. */
function fakeRide() {
	const ride = $state({
		road: null as Road | null,
		recording: false,
		mode: 'grade' as 'grade' | 'watts',
		seconds: 0,
	});
	return ride;
}

describe('the live split against your ghost (#3615)', () => {
	let stop: () => void = () => {};
	beforeEach(() => {
		api.mockReset();
		api.mockResolvedValue({
			ok: true,
			data: { best: true, metres: [0, 5, 10, 15, 20] },
		});
	});
	afterEach(() => stop());

	async function riding(road: Road) {
		const ride = fakeRide();
		let ghost!: ReturnType<typeof createGhostSplit>;
		stop = $effect.root(() => {
			ghost = createGhostSplit(() => ride as unknown as FreeRide);
		});
		ride.road = road;
		flushSync();
		await vi.waitFor(() => expect(api).toHaveBeenCalled());
		await Promise.resolve();
		ride.recording = true;
		return { ride, ghost };
	}

	it('races your ghost from the road’s start, ahead and behind', async () => {
		const { ride, ghost } = await riding({
			id: 'r1',
			m: 0,
			lap: 0,
			borrowed: false,
		});
		expect(api).toHaveBeenCalledWith('/api/routes/r1/ghost');
		ride.seconds = 2;
		ride.road = { ...ride.road!, m: 12 };
		// The ghost reached 12 m at 2.4 s: you are 0.4 s ahead.
		await vi.waitFor(() => expect(ghost.split?.best).toBe(true));
		expect(ghost.split!.seconds).toBeCloseTo(-0.4, 9);
		ride.seconds = 4;
		expect(ghost.split!.seconds).toBeCloseTo(1.6, 9);
	});

	it('races nothing past its end, on a later lap, or in watts', async () => {
		const { ride, ghost } = await riding({
			id: 'r1',
			m: 0,
			lap: 0,
			borrowed: false,
		});
		ride.seconds = 9;
		ride.road = { ...ride.road!, m: 25 };
		expect(ghost.split).toBeNull();
		ride.road = { ...ride.road!, m: 12, lap: 1 };
		expect(ghost.split).toBeNull();
		ride.road = { ...ride.road!, lap: 0 };
		ride.mode = 'watts';
		expect(ghost.split).toBeNull();
	});

	it('reads no ghost for a ride carried on partway, or on a borrowed road', async () => {
		const ride = fakeRide();
		stop = $effect.root(() => {
			createGhostSplit(() => ride as unknown as FreeRide);
		});
		ride.road = { id: 'r1', m: 1200, lap: 0, borrowed: false };
		flushSync();
		ride.road = { id: 'r2', m: 0, lap: 0, borrowed: true };
		flushSync();
		expect(api).not.toHaveBeenCalled();
	});

	it('says nothing when you have never ridden the road', async () => {
		api.mockResolvedValue({
			ok: false,
			error: { error: 'not_found', message: 'You have not ridden this road.' },
		});
		const { ride, ghost } = await riding({
			id: 'r1',
			m: 0,
			lap: 0,
			borrowed: false,
		});
		ride.seconds = 2;
		ride.road = { ...ride.road!, m: 12 };
		expect(ghost.split).toBeNull();
	});
});
