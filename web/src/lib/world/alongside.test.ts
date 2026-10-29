// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { at, leftOf } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import type { Route } from '$lib/road/route';
import type { RoadMate } from '$lib/channel/road-mates';
import { createAlongside } from './alongside';
import { compose, type Hud } from './compose';
import { RIDE } from './look.test-helper';
import { routeOfRoad } from './road-route';
import { simRider } from './sim';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * A free ride's world with channel-mates on its road (#3117): each figure at
 * that rider's own metre, rolling on at their speed between ticks.
 */

let route: Route;
let world: World;
beforeAll(() => {
	route = routeOfRoad(legsRoad([1500, 2], [1500, 6], [1000, 0]));
	world = generate(route);
}, BUILD_MS);

const kim = (m: number, mps = 8): RoadMate => ({
	id: 'kim',
	name: 'Kim',
	m,
	mps,
	watts: 210,
	ftp: 250,
	speaking: false,
});

describe('channel-mates on a free ride’s road', () => {
	it('draws each mate at their own metre, a lane beside you, and lets them go when they leave the road', () => {
		let mates: RoadMate[] = [kim(400)];
		let hud: Hud | null = null;
		const w = compose(
			{
				route,
				world,
				style: RIDE,
				ftp: 250,
				youId: 'me',
				metre: () => ({ m: 300, mps: 0 }),
				mates: () => mates,
				onTick: (next) => (hud = next),
			},
			null,
		);
		// Three of the hub's ticks, a second apart, drawn at 30 fps.
		for (let k = 1; k <= 90; k++) {
			if (k % 30 === 0) mates = [kim(400 + (k / 30) * 8)];
			w.advanceBy(1 / 30);
		}
		const kimOn = hud!.riders.find((r) => r.id === 'kim')!;
		const me = hud!.riders.find((r) => r.you)!;
		// Within the ease of the hub's last metre for them, 424 m: never at yours.
		expect(Math.abs(kimOn.d - 424)).toBeLessThan(5);
		expect(me.d).toBeCloseTo(300, 0);
		expect(kimOn.lane).not.toBeCloseTo(me.lane, 1);
		// Drawn on the road where the HUD last said, in that lane: the HUD is
		// a quarter second old, and Kim rides 8 m a second.
		let figure: THREE.Object3D | undefined;
		w.scene.traverseVisible((o) => {
			if (o.userData.rider === 'kim') figure = o;
		});
		const v = figure!.getWorldPosition(new THREE.Vector3());
		const p = at(route, kimOn.d);
		const { lx, lz } = leftOf(p.heading);
		expect(
			Math.hypot(v.x - (p.x + lx * kimOn.lane), v.z - (p.z + lz * kimOn.lane)),
		).toBeLessThan(2.5);
		// Off the road again: gone from the world.
		mates = [];
		w.advanceBy(0.3);
		expect(hud!.riders.map((r) => r.id)).toEqual(['me']);
		expect(me.lane).toBeDefined();
		w.dispose();
	});

	it('draws a racer whose screen has gone in greys, with no zone ring (#3778)', () => {
		const you = simRider({
			id: 'me',
			name: 'Me',
			mass: 0,
			ftp: 250,
			you: true,
			watts: 0,
			d: 300,
		});
		const ridden = createAlongside().step(
			you,
			[kim(400), { ...kim(500), id: 'ana', faded: true }],
			0,
		);
		const of = (id: string) => ridden.find((r) => r.id === id)!;
		expect([of('kim').faded, of('kim').ring]).toEqual([false, true]);
		expect([of('ana').faded, of('ana').ring]).toEqual([true, false]);
	});

	it('keeps mates riding the other way in their own half of the road (#4261)', () => {
		const you = simRider({
			id: 'me',
			name: 'Me',
			mass: 0,
			ftp: 250,
			you: true,
			watts: 0,
			d: 300,
		});
		const back = (id: string, m: number): RoadMate => ({
			...kim(m, -8),
			id,
			reverse: true,
		});
		const ridden = createAlongside().step(
			you,
			[back('ana', 500), kim(400), back('bo', 600), back('cy', 700)],
			0,
		);
		const of = (id: string) => ridden.find((r) => r.id === id)!;
		// Lanes are metres left of the middle as each rider faces.
		for (const id of ['ana', 'bo', 'cy']) {
			expect(of(id).reverse, id).toBe(true);
			expect(of(id).lane!, id).toBeLessThan(0);
		}
		expect(of('kim').reverse).toBe(false);
		expect(of('kim').lane).not.toBeCloseTo(you.lane!, 1);
	});

	it('leaves a session’s bunch to the bunch: mates draw only where it has no view (#3778)', () => {
		let hud: Hud | null = null;
		const w = compose(
			{
				route,
				world,
				style: RIDE,
				ftp: 250,
				youId: 'me',
				metre: () => ({ m: 300, mps: 8 }),
				bunch: () => ({
					m: 300,
					mps: 8,
					elapsed: 30,
					order: ['me', 'tom'],
					offsets: {},
					resting: [],
					present: new Map([
						['me', { watts: 200, ftp: 250 }],
						['tom', { watts: 200, ftp: 250 }],
					]),
					game: false,
					cheered: [],
				}),
				mates: () => [],
				onTick: (next) => (hud = next),
			},
			null,
		);
		for (let k = 0; k < 30; k++) w.advanceBy(1 / 30);
		expect(hud!.riders.map((r) => r.id).sort()).toEqual(['me', 'tom']);
		w.dispose();
	});
});
