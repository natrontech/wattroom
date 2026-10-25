// @vitest-environment happy-dom
import { flushSync, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('$lib/api', () => ({ api: (...args: unknown[]) => api(...args) }));

import type { FreeRide } from './free-ride.svelte';
import { createGhostSplit } from './ghost-split.svelte';

type Road = {
	id: string;
	m: number;
	lap: number;
	borrowed: boolean;
	virtualMps?: number;
	length?: number;
	name?: string;
	atEnd?: boolean;
};

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
			data: {
				best: true,
				startedAt: '2026-08-11T16:30:00Z',
				metres: [0, 5, 10, 15, 20],
			},
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

	it('places your ghost where it was at this second, named for its day, and lets it go at its end (#3245)', async () => {
		const { ride, ghost } = await riding({
			id: 'r1',
			m: 0,
			lap: 0,
			borrowed: false,
		});
		ride.seconds = 2;
		ride.road = { ...ride.road!, virtualMps: 5 };
		await vi.waitFor(() => expect(ghost.rider).not.toBeNull());
		expect(ghost.rider).toMatchObject({ m: 10, mps: 5 });
		expect(ghost.rider!.label).toMatch(/^\w+day-you, /);
		// You rest: the ghost's clock is yours, so it waits where it is.
		ride.road = { ...ride.road!, virtualMps: 0 };
		expect(ghost.rider).toMatchObject({ m: 10, mps: 0 });
		ride.road = { ...ride.road!, virtualMps: 5 };
		ride.seconds = 4;
		expect(ghost.rider).toMatchObject({ m: 20, mps: 5 });
		ride.seconds = 5;
		expect(ghost.rider).toBeNull();
		ride.seconds = 2;
		ride.mode = 'watts';
		expect(ghost.rider).toBeNull();
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

describe('the gap called along the road, and a new best (#3246)', () => {
	let stop: () => void = () => {};
	afterEach(() => stop());

	// Your best rode a 200 m road at 5 m a second, saved on arrival: its last
	// sample 195 m, a second short of the end it reached at 40 s.
	async function racing(best = true) {
		api.mockReset();
		api.mockResolvedValue({
			ok: true,
			data: {
				best,
				startedAt: '2026-08-11T16:30:00Z',
				metres: Array.from({ length: 40 }, (_, t) => 5 * t),
			},
		});
		const ride = fakeRide();
		let ghost!: ReturnType<typeof createGhostSplit>;
		stop = $effect.root(() => {
			ghost = createGhostSplit(() => ride as unknown as FreeRide);
		});
		ride.road = road(0);
		flushSync();
		await vi.waitFor(() => expect(api).toHaveBeenCalled());
		await Promise.resolve();
		ride.recording = true;
		await tick();
		const calls: string[] = [];
		// You ride 6 m a second, a second at a time. An effect in a bare root
		// runs a microtask after the write.
		const to = async (seconds: number, mps = 6) => {
			for (let s = ride.seconds + 1; s <= seconds; s++) {
				ride.seconds = s;
				ride.road = road(mps * s);
				await tick();
				if (ghost.call && calls.at(-1) !== ghost.call.said)
					calls.push(ghost.call.said);
			}
		};
		return { ride, ghost, calls, to };
	}
	const road = (m: number): Road => ({
		id: 'r1',
		m: Math.min(m, 200),
		lap: 0,
		borrowed: false,
		length: 200,
		name: 'The Pass',
		atEnd: m >= 200,
	});

	it('reads the climb card’s gap from its foot, once past it', async () => {
		const { ghost, to } = await racing();
		await to(8);
		// The foot at 60 m: not reached at 48 m.
		expect(ghost.since(60)).toBeNull();
		await to(20);
		// At 120 m you are 4 s up, 2 of them won since the foot.
		expect(ghost.split!.seconds).toBeCloseTo(-4, 9);
		expect(ghost.since(60)!.seconds).toBeCloseTo(-2, 9);
		expect(ghost.since(60)!.best).toBe(true);
	});

	it('calls a quarter, halfway and three quarters, then a new best at the end', async () => {
		const { ride, ghost, calls, to } = await racing();
		await to(40);
		expect(calls).toEqual([
			'A quarter in, 2 seconds ahead of your best',
			'Halfway, 3 seconds ahead of your best',
			'Three quarters in, 5 seconds ahead of your best',
			'New best on The Pass, 6 seconds faster',
		]);
		expect(ghost.call).toMatchObject({
			kind: 'pr',
			name: 'New best',
			line: '6 s faster',
		});
		// Pedalling on at the end changes nothing: the time is the arrival's.
		expect(ghost.newBest).toBe('New best on The Pass, 6 s faster');
		// Saved in Watts, the trainer held the ride: no time is yours (ADR-0074).
		ride.mode = 'watts';
		expect(ghost.newBest).toBeNull();
	});

	it('keeps your line and the marks in Watts, so nothing is called late', async () => {
		const { ride, ghost, calls, to } = await racing();
		await to(9);
		// The trainer holds you from 54 m to 120 m: halfway passes unraced.
		ride.mode = 'watts';
		await to(20);
		ride.mode = 'grade';
		await to(22);
		expect(calls).toEqual(['A quarter in, 2 seconds ahead of your best']);
		// A foot at 102 m, passed in Watts at 17 s against the ghost's 20.4 s:
		// 4.4 s up at 132 m, 1 s of it won since.
		expect(ghost.since(102)!.seconds).toBeCloseTo(-1, 9);
	});

	it('claims no new best when slower, or against your last ride', async () => {
		const slower = await racing();
		await slower.to(50, 4);
		expect(slower.ghost.newBest).toBeNull();
		expect(slower.ghost.call?.said).toBe(
			'Three quarters in, 8 seconds behind your best',
		);
		stop();
		const last = await racing(false);
		await last.to(40);
		expect(last.ghost.newBest).toBeNull();
		expect(last.ghost.call?.said).toBe(
			'Three quarters in, 5 seconds ahead of your last ride',
		);
	});
});

// TARGETS ride-free-road-ghost 3 (#3245, ADR-0068): a ghost rides only where
// your own watts move your dot — never an ERG ride, a later lap, a crew's
// road, or a session, bunch, race or game, whose worlds take no ghosts.
describe('ghost placement', () => {
	let stop: () => void = () => {};
	afterEach(() => stop());

	it('places none in watts (ERG by the road), on a later lap, or on a crew’s road', async () => {
		api.mockResolvedValue({
			ok: true,
			data: { best: true, startedAt: '2026-08-11T16:30:00Z', metres: [0, 5] },
		});
		const ride = fakeRide();
		let ghost!: ReturnType<typeof createGhostSplit>;
		stop = $effect.root(() => {
			ghost = createGhostSplit(() => ride as unknown as FreeRide);
		});
		ride.road = { id: 'r1', m: 0, lap: 0, borrowed: false, virtualMps: 5 };
		flushSync();
		await vi.waitFor(() => expect(api).toHaveBeenCalled());
		ride.recording = true;
		await vi.waitFor(() => expect(ghost.rider).not.toBeNull());
		ride.mode = 'watts';
		expect(ghost.rider).toBeNull();
		ride.mode = 'grade';
		ride.road = { ...ride.road!, lap: 1 };
		expect(ghost.rider).toBeNull();
		ride.road = { id: 'r2', m: 0, lap: 0, borrowed: true, virtualMps: 5 };
		flushSync();
		await vi.waitFor(() => expect(ghost.rider).toBeNull());
	});

	it('places none while the ride is a session’s', () => {
		stop = $effect.root(() => {
			const ghost = createGhostSplit(() => null);
			expect(ghost.rider).toBeNull();
		});
		expect(api).not.toHaveBeenCalled();
	});

	it('mounts ghosts only on the free ride’s world, never a session’s or a workout’s', () => {
		const files = import.meta.glob('/src/**/*.svelte', {
			query: '?raw',
			import: 'default',
			eager: true,
		}) as Record<string, string>;
		const haunted = Object.entries(files)
			.filter(([, src]) =>
				(src.match(/<RideWorld\b[\s\S]*?\/>/g) ?? []).some((tag) =>
					/\sghosts=/.test(tag),
				),
			)
			.map(([path]) => path);
		expect(haunted).toEqual(['/src/lib/ride/FreeRiding.svelte']);
	});
});
