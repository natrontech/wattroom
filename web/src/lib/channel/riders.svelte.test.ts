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

function riding(bunchM: number, reverse = false, ridden = workout) {
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
			segments: () => flatten(ridden),
			workout: () => ridden,
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

	it('paints the next block where the bunch will be when it starts, in your words (#3101)', () => {
		const twoBlocks: Workout = {
			...workout,
			steps: [
				{ type: 'steady', seconds: 90, target: 0.7 },
				{ type: 'steady', seconds: 600, target: 0.5 },
			],
		};
		// 60 s in at 8 m/s: the recovery starts 30 s on, up the 5 %.
		const { roster, stop } = riding(1500, false, twoBlocks);
		const [gate, ...more] = roster.ridden!.gates;
		expect(more).toEqual([]);
		expect(gate.words).toBe('ACTIVE RECOVERY 125 W');
		expect(gate.m).toBeGreaterThan(1500 + 30 * 2);
		expect(gate.m).toBeLessThan(1500 + 30 * 8);
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

// A race or a game on a road has no segments, so there is no block — but the
// session still rides a road, and slot 1 reads the road line at your metre.
function blockless(world: object, game?: object) {
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
			segments: () => [],
			workout: () => workout,
		});
	});
	live.tick = {
		at: 1,
		roster: [{ id: 'me', name: 'Me' }],
		state: {
			route: {
				id: 'r1',
				hash: 'h',
				genName: 'Road · 3.0 km',
				fromM: 400,
				lengthM: 3000,
			},
		},
		world,
		...(game && { game }),
	} as unknown as ServerTick;
	flushSync();
	return { roster, stop };
}

describe('a block-less road session — a race or a game on a road (#4192)', () => {
	it('reads the road line at your metre, with no block to carry it', () => {
		const { roster, stop } = blockless({
			bunchM: 1500,
			speedMps: 8,
			offsets: { me: -50 },
		});
		expect(roster.block).toBeNull();
		expect(roster.roadReadout!.km).toBeCloseTo(1.495, 5);
		expect(roster.roadReadout!.totalKm).toBeCloseTo(3, 5);
		expect(roster.roadReadout!.grade).toBeCloseTo(5, 5);
		stop();
	});

	it('reads your racer’s metre in a race, on the road cut at its line', () => {
		const { roster, stop } = blockless(
			{ bunchM: 0, speedMps: 0, racers: { me: { m: 900, v: 9 } } },
			{ phase: 'running', race: { klaxonAtMs: 1000, lineM: 2000 } },
		);
		expect(roster.block).toBeNull();
		expect(roster.roadReadout!.km).toBeCloseTo(0.9, 5);
		expect(roster.roadReadout!.totalKm).toBeCloseTo(2, 5);
		stop();
	});
});

describe('a rider whose socket dropped while voice holds them (#4090)', () => {
	it('stays on the roster, read as voice only with no live numbers', () => {
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
				running: () => false,
				shared: () => undefined,
				bias: () => 1,
				segments: () => [],
				workout: () => null,
			});
		});
		live.tick = {
			at: 1,
			roster: [{ id: 'kim', name: 'Kim', linkLost: true }],
			voice: ['kim'],
		} as unknown as ServerTick;
		flushSync();
		expect(roster.riders[0]).toMatchObject({
			id: 'kim',
			inVoice: true,
			linkLost: true,
			stale: true,
		});
		stop();
	});
});
