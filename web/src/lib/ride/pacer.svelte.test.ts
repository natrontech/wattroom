// @vitest-environment happy-dom
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const played: string[] = [];
vi.mock('#lib/sound/cues.ts', () => ({
	play: (id: string) => played.push(id),
}));

import { legsRoad } from '#lib/road/fixtures.ts';
import { pacerLine, PACER_PAR } from '#lib/road/pacer.ts';
import type { FreeRide } from './free-ride.svelte';
import { createPacer } from './pacer.svelte';

// A flat 2 km with one hairpin, a 180° turn 1 km in.
const profile = legsRoad([2_000, 0]);
profile.turns[50] = 180;
const HAIRPIN_M = 1_010;
const line = pacerLine(profile, PACER_PAR.C);
const reached = (m: number) => line.findIndex((at) => at >= m);

/** Just the free ride the pacer reads, reactive as the real one is. */
function fakeRide() {
	const ride = $state({
		road: {
			id: 'r1',
			m: 0,
			lap: 0,
			from: 0,
			reverse: false,
			virtualMps: 8,
			profile,
		},
		recording: true,
		mode: 'grade' as 'grade' | 'watts',
		seconds: 0,
	});
	return ride;
}

describe('the pacer on a solo route ride (#3281)', () => {
	let stop: () => void = () => {};
	afterEach(() => {
		stop();
		played.length = 0;
	});

	function riding() {
		const ride = fakeRide();
		let pacer!: ReturnType<typeof createPacer>;
		stop = $effect.root(() => {
			pacer = createPacer(() => ride as unknown as FreeRide);
		});
		flushSync();
		return { ride, pacer };
	}

	it('is off until a Category is picked, and the pick sounds its horn', () => {
		const { ride, pacer } = riding();
		ride.seconds = 10;
		expect(pacer.rider).toBeNull();
		pacer.pick('C');
		expect(played).toEqual(['horn']);
		expect(pacer.rider).toEqual({
			m: line[10],
			mps: line[11] - line[10],
			label: 'Pacer C',
		});
		pacer.pick(null);
		expect(pacer.rider).toBeNull();
	});

	it('shows the gap within 50 m only', () => {
		const { ride, pacer } = riding();
		pacer.pick('C');
		ride.seconds = 60;
		ride.road = { ...ride.road, m: line[60] - 30 };
		expect(pacer.gap?.metres).toBeCloseTo(30, 6);
		expect(pacer.gap?.category).toBe('C');
		ride.road = { ...ride.road, m: line[60] - 51 };
		expect(pacer.gap).toBeNull();
		expect(pacer.rider).not.toBeNull();
	});

	it('rides only where your own watts move your dot: Road mode, the first lap', () => {
		const { ride, pacer } = riding();
		pacer.pick('B');
		ride.seconds = 30;
		ride.mode = 'watts';
		expect(pacer.rider).toBeNull();
		ride.mode = 'grade';
		ride.road = { ...ride.road, lap: 1 };
		expect(pacer.rider).toBeNull();
	});

	it('sounds its horn at a hairpin it rounds near you, not far off', async () => {
		const near = riding();
		near.pacer.pick('C');
		played.length = 0;
		const at = reached(HAIRPIN_M);
		for (const s of [at - 2, at - 1, at, at + 1]) {
			near.ride.seconds = s;
			near.ride.road = { ...near.ride.road, m: line[s] - 20 };
			// An effect in a bare root runs a microtask after the write.
			await tick();
		}
		expect(played).toEqual(['horn']);
		stop();

		played.length = 0;
		const far = riding();
		far.pacer.pick('C');
		played.length = 0;
		for (const s of [at - 2, at - 1, at, at + 1]) {
			far.ride.seconds = s;
			far.ride.road = { ...far.ride.road, m: line[s] - 200 };
			await tick();
		}
		expect(played).toEqual([]);
	});
});
