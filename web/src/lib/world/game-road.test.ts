// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BunchView, GamePlay } from '$lib/channel/bunch-view';
import { at } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import { STYLES } from '../../routes/(app)/dev/world/styles';
import { fogEle, makeGameRoad, nextStand } from './game-road';
import { yOf } from './geometry';
import { routeOfRoad } from './road-route';
import type { World } from './world';

const style = STYLES.find((s) => s.id === 'bluehour') ?? STYLES[0];
// Climbing all the way, so the fog has somewhere to rise to.
const route = routeOfRoad(legsRoad([3000, 4], [3000, 6]));
const hairpins = [2000, 3500];
const world = {
	markers: hairpins.map((d) => ({ kind: 'hairpin', d, label: '' })),
} as unknown as World;

const view = (m: number, at: number, play?: GamePlay, mps = 8): BunchView => ({
	m,
	mps,
	at,
	elapsed: at / 1000,
	order: ['a', 'b'],
	offsets: {},
	resting: [],
	present: new Map(),
	game: !!play,
	cheered: [],
	play,
});

const arches = (g: THREE.Group) => {
	const out: THREE.Object3D[] = [];
	g.traverse((o) => {
		if (o.userData.kind === 'arch') out.push(o);
	});
	return out;
};

describe('a game on the road (#3114)', () => {
	it('stands a rider who is out at the first hairpin 300 m to 5 km ahead, else 300 m ahead', () => {
		expect(nextStand(1000, hairpins, 6000, false)).toBe(2000);
		// The next one is too near: the one after.
		expect(nextStand(1800, hairpins, 6000, false)).toBe(3500);
		// None ahead within 5 km: 300 m on.
		expect(nextStand(3400, hairpins, 6000, false)).toBe(3700);
		// A loop's next lap counts its hairpins again.
		expect(nextStand(5900, hairpins, 6000, true)).toBe(8000);
	});

	it('raises the fog from the road’s foot toward its top, never over the bunch', () => {
		const top = Math.max(...route.ele);
		const low = fogEle(route, 1, top);
		const later = fogEle(route, 6, top);
		expect(later).toBeGreaterThan(low);
		expect(fogEle(route, 50, top)).toBeLessThan(top);
		// Riding low, the fog stays under you whatever the round.
		expect(fogEle(route, 50, Math.min(...route.ele) + 20)).toBeLessThan(
			Math.min(...route.ele) + 20,
		);
	});

	it('puts Backyard Ramp’s next round under an arch where the bunch will be, held for the round', () => {
		const g = makeGameRoad(route, world, style);
		const play = (round: number): GamePlay => ({
			mode: 'backyard-ramp',
			round,
			roundEndsAt: 180_000 * round,
			out: [],
		});
		g.update(view(100, 60_000, play(1)), 0, 0, false);
		expect(arches(g.group)).toHaveLength(1);
		const first = arches(g.group)[0];
		// 120 s left at 8 m/s: 960 m on from the bunch.
		expect(first.userData.label).toBe('ROUND 2');
		const there = at(route, 1060);
		expect(first.position.x).toBeCloseTo(there.x, 3);
		expect(first.position.z).toBeCloseTo(there.z, 3);
		g.update(view(500, 110_000, play(1)), 50, 0, false);
		expect(arches(g.group)[0]).toBe(first);
		g.update(view(1100, 190_000, play(2)), 130, 0, false);
		expect(arches(g.group)).toHaveLength(1);
		expect(arches(g.group)[0]).not.toBe(first);
		g.update(
			view(1200, 200_000, { ...play(2), mode: 'watt-golf' }),
			140,
			0,
			false,
		);
		expect(arches(g.group)).toHaveLength(0);
	});

	it('aims the arch from the bunch’s speed while it is out of sight, and never moves it in sight', () => {
		const g = makeGameRoad(route, world, style);
		const play: GamePlay = {
			mode: 'backyard-ramp',
			round: 1,
			roundEndsAt: 180_000,
			out: [],
		};
		// The game's first tick: the bunch is still standing, with no speed to aim by.
		g.update(view(0, 0, play, 0), 0, 0, false);
		expect(arches(g.group)).toHaveLength(0);
		// Rolling at 6 m/s, 3 min to go: aimed 1,080 m on.
		g.update(view(10, 0, play, 6), 0, 0, false);
		expect(arches(g.group)[0].position.x).toBeCloseTo(
			at(route, 10 + 6 * 180).x,
			3,
		);
		// Up to speed, 1.4 km to go: re-aimed while still out of sight.
		g.update(view(40, 5000, play), 5, 0, false);
		const aimed = at(route, 40 + 8 * 175);
		expect(arches(g.group)[0].position.x).toBeCloseTo(aimed.x, 3);
		// In sight: a slower bunch no longer moves it.
		g.update(view(500, 120_000, play, 6), 120, 0, false);
		expect(arches(g.group)[0].position.x).toBeCloseTo(aimed.x, 3);
	});

	it('raises Collective Ramp’s fog a round at a time, stepping under reduced motion', () => {
		const sea = (g: ReturnType<typeof makeGameRoad>) => {
			let found: THREE.Object3D | null = null;
			g.group.traverse((o) => {
				if (o.userData.kind === 'fog-sea') found = o;
			});
			return found as THREE.Object3D | null;
		};
		const play = (round: number): GamePlay => ({
			mode: 'collective-ramp',
			round,
			out: [],
		});
		const g = makeGameRoad(route, world, style);
		g.update(view(5900, 0, play(1)), 0, 1 / 30, false);
		const one = sea(g)!.position.y;
		expect(sea(g)!.visible).toBe(true);
		g.update(view(5900, 1000, play(4)), 1, 1 / 30, false);
		// Rising, not there yet.
		expect(sea(g)!.position.y).toBeGreaterThan(one);
		const want = yOf(route, fogEle(route, 4, route.ele.at(-1)!));
		expect(sea(g)!.position.y).toBeLessThan(want);
		for (let k = 0; k < 60; k++)
			g.update(view(5900, 1000, play(4)), 1, 1 / 30, false);
		expect(sea(g)!.position.y).toBeCloseTo(want, 3);

		const steady = makeGameRoad(route, world, style);
		steady.update(view(5900, 0, play(1)), 0, 1 / 30, true);
		steady.update(view(5900, 1000, play(4)), 1, 1 / 30, true);
		expect(sea(steady)!.position.y).toBeCloseTo(want, 3);
		steady.update(view(5900, 2000, undefined), 2, 1 / 30, true);
		expect(sea(steady)!.visible).toBe(false);
	});

	it('stands each rider who is out, moves them on once passed, and rings the cowbell as the bunch rides by', () => {
		const g = makeGameRoad(route, world, style);
		const play: GamePlay = { mode: 'backyard-ramp', round: 2, out: ['b'] };
		g.update(view(1000, 0, play), 0, 0, false);
		expect(g.stands().get('b')).toBe(2000);
		expect(g.rang).toBe(false);
		let rings = 0;
		// The bunch rides on at 8 m/s, a tick a second.
		for (let s = 1; s <= 150; s++) {
			g.update(view(1000 + 8 * s, s * 1000, play), s, 1, false);
			if (g.rang) rings++;
		}
		// Passed at 2000 m (125 s); 60 m and 60 s on, b moves to the next hairpin.
		expect(rings).toBe(1);
		expect(g.stands().get('b')).toBe(3500);
		g.update(view(2300, 151_000, { ...play, out: [] }), 151, 1, false);
		expect(g.stands().size).toBe(0);
	});
});
