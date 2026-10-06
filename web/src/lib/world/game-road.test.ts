// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BunchView, GamePlay } from '$lib/channel/bunch-view';
import { at } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import { STYLES } from '../../routes/(app)/dev/world/styles';
import { fogEle, makeGameRoad, nextStand, rideAhead } from './game-road';
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

	it('lays the fog under the bunch, closer every round, never over it', () => {
		expect(fogEle(1, 600)).toBe(552);
		expect(fogEle(2, 600)).toBe(558);
		expect(fogEle(2, 700)).toBe(658);
		// Never nearer than 10 m, however many rounds.
		expect(fogEle(50, 600)).toBe(590);
	});

	it('rides ahead the way the hub steps the bunch: slower up a climb, from a standing start too', () => {
		const flat = routeOfRoad(legsRoad([6000, 0]));
		const climb = routeOfRoad(legsRoad([6000, 6]));
		const onFlat = rideAhead(flat, 0, 8, 0.8, 120);
		expect(rideAhead(climb, 0, 8, 0.8, 120)).toBeLessThan(onFlat * 0.6);
		expect(rideAhead(flat, 0, 0, 0.8, 120)).toBeLessThan(onFlat);
		// Capped where the bunch caps a rider.
		expect(rideAhead(flat, 0, 8, 3, 120)).toBe(rideAhead(flat, 0, 8, 1.5, 120));
	});

	it('puts Backyard Ramp’s next round under an arch where the bunch will be, held for the round', () => {
		const g = makeGameRoad(route, world, style);
		const play = (round: number): GamePlay => ({
			mode: 'backyard-ramp',
			round,
			linePct: 0.8,
			roundEndsAt: 180_000 * round,
			out: [],
		});
		// The game's first tick, the bunch standing: aimed from there all the same.
		g.update(view(0, 0, play(1), 0), 0, 0, false);
		expect(arches(g.group)).toHaveLength(1);
		const first = arches(g.group)[0];
		expect(first.userData.round).toBe(2);
		const there = at(route, rideAhead(route, 0, 0, 0.8, 180));
		expect(first.position.x).toBeCloseTo(there.x, 3);
		expect(first.position.z).toBeCloseTo(there.z, 3);
		// In sight, a bunch riding slower than aimed for does not move it.
		const held = first.position.clone();
		g.update(view(600, 120_000, play(1), 2), 120, 0, false);
		expect(arches(g.group)[0]).toBe(first);
		expect(first.position.distanceTo(held)).toBe(0);
		// The next round, the next arch; a mode with no line, none.
		g.update(view(1100, 190_000, play(2)), 130, 0, false);
		expect(arches(g.group)).toHaveLength(1);
		expect(arches(g.group)[0]).not.toBe(first);
		expect(arches(g.group)[0].userData.round).toBe(3);
		g.update(
			view(1200, 200_000, { ...play(2), mode: 'watt-golf' }),
			140,
			0,
			false,
		);
		expect(arches(g.group)).toHaveLength(0);
	});

	it('aims the arch again while it is out of sight', () => {
		const long = routeOfRoad(legsRoad([9000, 0]));
		const g = makeGameRoad(long, world, style);
		const play: GamePlay = {
			mode: 'backyard-ramp',
			round: 1,
			linePct: 0.8,
			roundEndsAt: 180_000,
			out: [],
		};
		// A bunch said to roll far faster than the line rides: aimed well over a kilometre on.
		g.update(view(0, 0, play, 30), 0, 0, false);
		const far = arches(g.group)[0].position.x;
		// A tick later, nearer the line's own speed: aimed again, nearer.
		g.update(view(8, 1000, play, 8), 1, 0, false);
		const again = arches(g.group)[0].position.x;
		expect(
			Math.abs(again - at(long, rideAhead(long, 8, 8, 0.8, 179)).x),
		).toBeLessThan(0.001);
		expect(again).not.toBeCloseTo(far, 0);
	});

	it('raises Collective Ramp’s fog a round at a time, eased, and held under reduced motion', () => {
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
		const m = 5000;
		const ele = at(route, m).ele;
		const g = makeGameRoad(route, world, style);
		g.update(view(m, 0, play(1)), 0, 1 / 30, false);
		expect(sea(g)!.visible).toBe(true);
		expect(sea(g)!.position.y).toBeCloseTo(yOf(route, fogEle(1, ele)), 3);
		g.update(view(m, 1000, play(4)), 1, 1 / 30, false);
		// Rising, not there yet.
		const want = yOf(route, fogEle(4, ele));
		expect(sea(g)!.position.y).toBeGreaterThan(yOf(route, fogEle(1, ele)));
		expect(sea(g)!.position.y).toBeLessThan(want);
		for (let k = 0; k < 600; k++)
			g.update(view(m, 1000, play(4)), 1, 1 / 30, false);
		expect(sea(g)!.position.y).toBeCloseTo(want, 2);

		const steady = makeGameRoad(route, world, style);
		steady.update(view(m, 0, play(1)), 0, 1 / 30, true);
		steady.update(view(m, 1000, play(4)), 1, 1 / 30, true);
		expect(sea(steady)!.position.y).toBeCloseTo(want, 3);
		steady.update(view(m, 2000, undefined), 2, 1 / 30, true);
		expect(sea(steady)!.visible).toBe(false);
	});

	it('lays the fog flat and unlit, at least 10 m under the riders, where the ground beside the road hides it', () => {
		const g = makeGameRoad(route, world, style);
		const fog = () => {
			let found: THREE.Mesh | null = null;
			g.group.traverse((o) => {
				if (o.userData.kind === 'fog-sea') found = o as THREE.Mesh;
			});
			return found! as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
		};
		for (const round of [1, 3, 8, 40])
			for (const m of [0, 1500, 3000, 5500]) {
				const play: GamePlay = { mode: 'collective-ramp', round, out: [] };
				g.update(view(m, round * 1000, play), round, 1 / 30, true);
				expect(fog().position.y).toBeLessThanOrEqual(
					yOf(route, at(route, m).ele - 10) + 1e-6,
				);
			}
		const sea = fog();
		sea.geometry.computeBoundingBox();
		const box = sea.geometry.boundingBox!;
		expect(box.max.y - box.min.y).toBeCloseTo(0, 6);
		// Unlit: no light shades it, and nothing on it glows (ADR-0005).
		expect(sea.material).toBeInstanceOf(THREE.MeshBasicMaterial);
		// Depth-tested: wherever the ground meets the road, the ground covers it.
		expect(sea.material.depthTest).toBe(true);
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
