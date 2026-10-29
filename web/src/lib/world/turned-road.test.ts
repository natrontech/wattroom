// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { at, lastMetre, leftOf } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import type { Route } from '$lib/road/route';
import type { RoadMate } from '$lib/channel/road-mates';
import { compose } from './compose';
import { KEEP_RIGHT } from './crew';
import { RIDE } from './look.test-helper';
import { routeOfRoad } from './road-route';
import type { RideMetre } from './sim';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * A ride back down its road (#3205, #4261): turned at an open road's end, or
 * a lap of a loop ridden the other way. `m` counts down the stored road, and
 * the world draws you facing the way you ride, in your own right lane, with
 * the chase eye behind you. A channel-mate riding the other way does the same.
 */

let route: Route;
let world: World;
beforeAll(() => {
	// Its last kilometre climbs at 5 %: ridden back, it descends.
	route = routeOfRoad(legsRoad([1500, 0], [1000, 5]));
	world = generate(route);
}, BUILD_MS);

const FPS = 30;
type World3 = ReturnType<typeof compose>;

/** The unit vector of travel on `r` at `d`, `way` 1 up the road and -1 back down it. */
const travel = (r: Route, d: number, way: number) => {
	const h = at(r, d).heading;
	return new THREE.Vector3(Math.sin(h) * way, 0, Math.cos(h) * way);
};

/**
 * Where `v` stands against `r` at `d`, riding `way`: metres ahead along it,
 * and metres to its left. A lap back starts at the road's end, so on a
 * lapped road its first metre is that end, never the next lap's start.
 */
function against(v: THREE.Vector3, r: Route, d: number, way: number) {
	const p = at(r, way < 0 && r.loop ? Math.min(d, lastMetre(r)) : d);
	const { lx, lz } = leftOf(p.heading);
	const dx = v.x - p.x;
	const dz = v.z - p.z;
	return {
		ahead: (dx * Math.sin(p.heading) + dz * Math.cos(p.heading)) * way,
		left: (dx * lx + dz * lz) * way,
	};
}

/** The way a rider's figure faces: its group's forward, +Z, in the world. */
const facing = (o: THREE.Object3D) =>
	new THREE.Vector3(0, 0, 1).applyQuaternion(
		o.getWorldQuaternion(new THREE.Quaternion()),
	);

function drawn(scene: THREE.Scene) {
	const riders = new Map<string, THREE.Object3D>();
	let trail: THREE.Mesh | undefined;
	scene.traverseVisible((o) => {
		if (o.userData.rider) riders.set(o.userData.rider, o);
		if (o.userData.kind === 'trail') trail = o as THREE.Mesh;
	});
	return { riders, trail: trail! };
}

/**
 * A rider `id` drawn at `d` on `r`, riding `way`: settled a few metres
 * behind it, never ahead, in their own right lane, facing their way.
 */
function riding(
	o: THREE.Object3D,
	r: Route,
	d: number,
	way: number,
	at: string,
) {
	const placed = against(o.getWorldPosition(new THREE.Vector3()), r, d, way);
	expect(placed.ahead, `along the road at ${at}`).toBeLessThan(1);
	expect(placed.ahead, `along the road at ${at}`).toBeGreaterThan(-5);
	expect(placed.left, `lane at ${at}`).toBeLessThan(-0.5);
	const go = travel(r, d, way);
	const face = facing(o);
	expect(face.x * go.x + face.z * go.z, `facing at ${at}`).toBeGreaterThan(
		0.95,
	);
	return { go, face };
}

/**
 * You at `d` on `r`, riding `way`, as `riding` has a rider, with your trail
 * behind your wheel and the chase eye behind you looking your way. Returns
 * how far the eye is from you.
 */
function chased(w: World3, r: Route, d: number, way: number, at: string) {
	const { riders, trail } = drawn(w.scene);
	const you = riders.get('me')!;
	const { go } = riding(you, r, d, way, at);
	const here = you.getWorldPosition(new THREE.Vector3());
	const ahead = against(here, r, d, way).ahead;
	// The trail behind your wheel, never ahead of it, in your lane.
	const line = trail.geometry.getAttribute('position');
	const v = new THREE.Vector3();
	for (let i = 0; i < line.count; i++) {
		const on = against(v.fromBufferAttribute(line, i), r, d, way);
		expect(on.ahead - ahead, `trail at ${at}`).toBeLessThan(0.3);
		expect(on.left, `trail's lane at ${at}`).toBeLessThan(-0.5);
	}
	const eye = w.camera.position.clone().sub(here);
	expect(eye.length(), `eye near you at ${at}`).toBeLessThan(20);
	expect(eye.x * go.x + eye.z * go.z, `eye behind at ${at}`).toBeLessThan(-4);
	const look = w.camera.getWorldDirection(new THREE.Vector3());
	expect(look.x * go.x + look.z * go.z, `gaze at ${at}`).toBeGreaterThan(0.5);
	return eye.length();
}

/** The ride's second the world reads its metre from. */
type Now = { ride: RideMetre };

/** Rides `seconds` of a ride, a frame at a time, checking you each frame after the first second. */
function rideThrough(w: World3, r: Route, seconds: RideMetre[], now: Now) {
	let nearest = Infinity;
	for (let s = 0; s < seconds.length; s++) {
		const ride = (now.ride = seconds[s]);
		const way = ride.reverse ? -1 : 1;
		for (let f = 0; f < FPS; f++) {
			w.advanceBy(1 / FPS);
			// The first second eases in from where the camera started.
			if (s === 0) continue;
			// Where the ride has you between its seconds: rolling on its way.
			const d = ride.m + (way * ride.mps * f) / FPS;
			nearest = Math.min(nearest, chased(w, r, d, way, `${s}s +${f}`));
		}
	}
	return nearest;
}

describe('a ride back down its road (#4261)', () => {
	it(
		'turned at an open road’s end, draws you facing back down it, keeping right, with the eye behind you',
		() => {
			const L = route.length;
			// The ride's seconds: up to the end at 8 m/s, two seconds stopped
			// there, then back down the road from standstill.
			const seconds: RideMetre[] = [];
			for (let m = L - 48; m < L; m += 8) seconds.push({ m, mps: 8 });
			seconds.push({ m: L, mps: 0 }, { m: L, mps: 0 });
			let m = L;
			for (const v of [2, 4, 6, 8, 8, 8, 8, 8]) {
				m -= v;
				seconds.push({ m, mps: v, reverse: true });
			}
			const now: Now = { ride: seconds[0] };
			const w = compose(
				{
					route,
					world,
					style: RIDE,
					ftp: 250,
					youId: 'me',
					metre: () => now.ride,
				},
				null,
			);
			// The turn is a cut: the eye never swept through you to get round.
			expect(rideThrough(w, route, seconds, now)).toBeGreaterThan(6);
			// And back down the climb your figure's nose points downhill.
			const you = drawn(w.scene).riders.get('me')!;
			expect(facing(you).y).toBeLessThan(0);
			w.dispose();
		},
		BUILD_MS,
	);

	it(
		'on a loop, rides a lap back across the line into the next, from the road’s far end',
		() => {
			// A lapped road whose ends lie apart: the next lap back starts at
			// its far end, at speed, as the road dot's laps start it.
			const lapped = { ...route, loop: true };
			const L = route.length;
			const seconds: RideMetre[] = [];
			for (let m = 40; m > 0; m -= 8)
				seconds.push({ m, mps: 8, reverse: true });
			for (let m = L; m > L - 48; m -= 8)
				seconds.push({ m, mps: 8, reverse: true });
			const now: Now = { ride: seconds[0] };
			const w = compose(
				{
					route,
					world,
					style: RIDE,
					ftp: 250,
					youId: 'me',
					loop: true,
					metre: () => now.ride,
				},
				null,
			);
			rideThrough(w, lapped, seconds, now);
			w.dispose();
		},
		BUILD_MS,
	);

	it(
		'draws a channel-mate riding the other way facing their way, in their own right lane',
		() => {
			let me: RideMetre = { m: 300, mps: 8 };
			// Kim rides back down the road: the hub's metres count down, and
			// road-mates reads a speed below zero off them.
			let kim: RoadMate = {
				id: 'kim',
				name: 'Kim',
				m: 700,
				mps: -8,
				reverse: true,
				watts: 210,
				ftp: 250,
				speaking: false,
			};
			const w = compose(
				{
					route,
					world,
					style: RIDE,
					ftp: 250,
					youId: 'me',
					metre: () => me,
					mates: () => [kim],
				},
				null,
			);
			for (let s = 0; s < 4; s++) {
				me = { m: 300 + 8 * s, mps: 8 };
				kim = { ...kim, m: 700 - 8 * s };
				for (let f = 0; f < FPS; f++) {
					w.advanceBy(1 / FPS);
					if (s === 0) continue;
					const at = `${s}s +${f}`;
					const { riders } = drawn(w.scene);
					const them = riders.get('kim')!;
					const d = kim.m - (8 * f) / FPS;
					riding(them, route, d, -1, at);
					// Not beside you: in the lane you keep, on their own side.
					const lane = against(
						them.getWorldPosition(new THREE.Vector3()),
						route,
						d,
						-1,
					).left;
					expect(lane, `Kim's lane at ${at}`).toBeCloseTo(KEEP_RIGHT, 0);
					// You, up the road in yours.
					chased(w, route, me.m + (8 * f) / FPS, 1, at);
				}
			}
			w.dispose();
		},
		BUILD_MS,
	);
});
