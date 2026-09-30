// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { ServerTick } from '$lib/protocol';
import { packRoad, type Road } from '$lib/road/road';
import { flatten } from '$lib/workout/engine';
import type { Workout } from '$lib/workout/types';
import { createRiders } from './riders.svelte';

// The crew's cut a session's pick carries (#3639): 3 km, a kilometre flat,
// then two at 5 % — nobody's route (#3054).
const cut: Road = {
	length: 3000,
	heights: Array.from({ length: 151 }, (_, i) =>
		i <= 50 ? 100 : 100 + (i - 50),
	),
	turns: Array<number>(150).fill(0),
};
const workout: Workout = {
	name: 'Road · 3.0 km',
	steps: [{ type: 'steady', seconds: 1200, target: 0.7 }],
	road: {
		routeId: 'r1',
		fromM: 400,
		toM: 3400,
		profile: btoa(String.fromCharCode(...packRoad(cut))),
		originM: 400,
	},
};

function riding(bunchM: number, reverse = false) {
	const live = $state<{ tick: ServerTick | null }>({ tick: null });
	let roster!: ReturnType<typeof createRiders>;
	const stop = $effect.root(() => {
		roster = createRiders({
			live,
			av: { videoOf: {}, voice: {}, speaking: {}, stageSources: [] },
			recording: { trace: [] } as never,
			myId: () => 'me',
			myName: () => 'Me',
			myTarget: () => 0,
			fallback: () => ({ ftp: 250, kg: 75, coach: false }),
			running: () => true,
			shared: () => ({ elapsed: 60 }),
			bias: () => 1,
			segments: () => flatten(workout),
			workout: () => workout,
		});
	});
	live.tick = {
		at: 1,
		roster: [],
		state: {
			route: {
				id: 'r1',
				hash: 'h',
				genName: 'Road · 3.0 km',
				fromM: 400,
				lengthM: 3000,
				reverse,
			},
		},
		world: { bunchM, speedMps: 8 },
	} as unknown as ServerTick;
	flushSync();
	return { roster, stop };
}

describe('a session on a road says where the bunch is, in slot 1 (#3639)', () => {
	it('reads the crew’s cut at the bunch’s metre', () => {
		const { roster, stop } = riding(1500);
		expect(roster.block?.road).toMatchObject({ km: 1.5, totalKm: 3 });
		expect(roster.block!.road!.grade).toBeCloseTo(5, 5);
		stop();
	});

	it('reads it turned round when the session rides it back', () => {
		const { roster, stop } = riding(500, true);
		// 500 m from the far end, ridden back: going down the 5 %.
		expect(roster.block?.road?.km).toBeCloseTo(0.5, 5);
		expect(roster.block!.road!.grade).toBeCloseTo(-5, 5);
		stop();
	});
});
