// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { at, closes, lapEnd, sampleAt } from '$lib/road/along';
import { toRoute } from '$lib/road/route';
import { syntheticPoints } from './synthetic';
import { alpineLoop } from '$lib/road/fixtures';
import type { PaintedGate } from '$lib/road/gates';
import type { Route } from '$lib/road/route';
import type { BunchView } from '$lib/channel/bunch-view';
import { compose, type Hud } from './compose';
import { RIDE } from './look.test-helper';
import { routeOfRoad } from './road-route';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * Past the first lap of a road the session laps (#3623): the bunch, its
 * chalk and its gates count metres with the laps unrolled (bunch-view.ts),
 * and the world draws each on the road at its lap's metre. The synthetic
 * Alpine loop is a straight road, its ends 57 km apart, as a crew's cut's
 * ends lie apart: a lap starts again where the road began.
 */

let route: Route;
let world: World;
beforeAll(() => {
	route = routeOfRoad(alpineLoop());
	world = generate(route);
}, BUILD_MS);

/** Metres between a point drawn in the scene and the drawn road at `d`. */
const off = (v: THREE.Vector3, d: number) => {
	const p = at(route, d);
	return Math.hypot(v.x - p.x, v.z - p.z);
};
const placeOf = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('a lapped road past its first lap', () => {
	it(
		'draws a rider crossing its end, the bunch’s chalk and gates on the next lap’s road, and the eye rides with them',
		() => {
			const L = route.length;
			// Two riders crossing the loop's end, a tick a second at 8 m/s.
			let m = L - 16;
			const gates: PaintedGate[] = [
				{ index: 1, m: L + 400, words: 'TEMPO 220 W', sprint: false },
				{ index: 2, m: L + 600, words: 'SPRINT', sprint: true },
			];
			const view = (): BunchView => ({
				m,
				mps: 8,
				elapsed: 30,
				order: ['a', 'b'],
				offsets: { b: -6 },
				resting: [],
				present: new Map([
					['a', { watts: 200, ftp: 250 }],
					['b', { watts: 200, ftp: 250 }],
				]),
				game: false,
				cheered: [],
				chalk: [{ key: 'kim@lap2', stamp: 'heart', letter: '', u: L + 200 }],
			});
			let hud: Hud | null = null;
			const w = compose(
				{
					route,
					world,
					style: RIDE,
					ftp: 250,
					youId: 'a',
					loop: true,
					// The ride's own metre is the lap's (road-place.ts).
					metre: () => ({ m: m % L, mps: 8 }),
					bunch: view,
					gates: () => gates,
					onTick: (next) => (hud = next),
				},
				null,
			);
			const drawn = () => {
				const riders = new Map<string, THREE.Object3D>();
				const marks: Record<string, THREE.Object3D> = {};
				w.scene.traverseVisible((o) => {
					if (o.userData.rider) riders.set(o.userData.rider, o);
					if (o.userData.kind) marks[o.userData.kind] ??= o;
					if (o.userData.words) marks[o.userData.words] = o;
				});
				return { riders, marks };
			};
			// A HUD snapshot every 0.3 s of frames: each rider on the drawn road
			// at their lap's metre, and your trail behind your wheel, never
			// across the gap between the road's ends.
			for (let k = 1; k <= 60; k++) {
				if (k % 10 === 0) m += 8;
				w.advanceBy(0.1);
				if (k % 3) continue;
				const { riders, marks } = drawn();
				for (const r of hud!.riders) {
					expect(r.d, `${r.id} at ${k}`).toBeLessThan(L);
					expect(
						off(placeOf(riders.get(r.id)!), r.d),
						`${r.id} at ${k}`,
					).toBeLessThan(2);
				}
				const you = placeOf(riders.get('a')!);
				// The chase eye a few metres behind you, never at the road's other end.
				expect(w.camera.position.distanceTo(you), `eye at ${k}`).toBeLessThan(
					20,
				);
				// And it looks up the road, never back across the gap to the other end.
				const look = w.camera.getWorldDirection(new THREE.Vector3());
				const h = at(route, hud!.riders.find((r) => r.you)!.d).heading;
				expect(
					look.x * Math.sin(h) + look.z * Math.cos(h),
					`gaze at ${k}`,
				).toBeGreaterThan(0.5);
				const trail = (marks.trail as THREE.Mesh).geometry.getAttribute(
					'position',
				);
				for (let i = 0; i < trail.count; i++)
					expect(
						Math.hypot(trail.getX(i) - you.x, trail.getZ(i) - you.z),
						`trail at ${k}`,
					).toBeLessThan(5);
			}
			const { riders, marks } = drawn();
			// 32 m into the second lap: a's place, b's six metres back.
			const lapM = m - L;
			expect(lapM).toBe(32);
			expect(off(placeOf(riders.get('a')!), lapM), 'a').toBeLessThan(4);
			expect(off(placeOf(riders.get('b')!), lapM - 6), 'b').toBeLessThan(4);
			expect(off(placeOf(marks.chalk), 200), 'chalk').toBeLessThan(3);
			expect(off(placeOf(marks['TEMPO 220 W']), 400), 'gate').toBeLessThan(
				0.01,
			);
			expect(off(placeOf(marks.SPRINT), 600), 'banner').toBeLessThan(0.01);
			w.dispose();
		},
		BUILD_MS,
	);
});

describe('you alone on a loop, past its end (#4261)', () => {
	it(
		'keeps the eye behind you and looking up the road as the next lap starts',
		() => {
			const L = route.length;
			let m = L - 40;
			const w = compose(
				{
					route,
					world,
					style: RIDE,
					ftp: 250,
					youId: 'a',
					loop: true,
					// The ride's own metre is the lap's, as the road dot's laps count it.
					metre: () => ({ m: m % L, mps: 8 }),
				},
				null,
			);
			const youAt = () => {
				let o: THREE.Object3D | undefined;
				w.scene.traverseVisible((x) => {
					if (x.userData.rider === 'a') o = x;
				});
				return placeOf(o!);
			};
			for (let k = 1; k <= 120; k++) {
				if (k % 10 === 0) m += 8;
				w.advanceBy(0.1);
				// The first second eases in from where the camera started.
				if (k < 10 || k % 3) continue;
				const you = youAt();
				expect(off(you, m % L), `you at ${k}`).toBeLessThan(10);
				expect(w.camera.position.distanceTo(you), `eye at ${k}`).toBeLessThan(
					20,
				);
				const look = w.camera.getWorldDirection(new THREE.Vector3());
				const h = at(route, m % L).heading;
				expect(
					look.x * Math.sin(h) + look.z * Math.cos(h),
					`gaze at ${k}`,
				).toBeGreaterThan(0.5);
			}
			expect(m % L).toBe(56);
			w.dispose();
		},
		BUILD_MS,
	);
});

describe('a lap of a road whose ends lie apart', () => {
	it('starts where the road began, and ends a hair short of its end', () => {
		const lapped = { ...route, loop: true };
		const L = route.length;
		expect(closes(route)).toBe(false);
		expect(closes(lapped)).toBe(false);
		expect(closes(toRoute(syntheticPoints()))).toBe(true);
		// Paint near a lap's end reads its rise inside that lap, never off the next one's start.
		expect(lapEnd(lapped, L + 30)).toBeCloseTo(2 * L, 3);
		expect(lapEnd(lapped, L + 30)).toBeLessThan(2 * L);
		expect(lapEnd(route, 30)).toBe(L);
		expect(sampleAt(lapped, L + route.step)).toBe(1);
		expect(sampleAt(route, L + route.step)).toBe(route.x.length - 1);
	});
});
