// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { at, leftOf } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import { ROADSIDE_SOUNDS_PER_MINUTE, roadsideSound } from '$lib/roadside';
import { RIDER_BOX } from '$lib/session/docks';
import { VERGE_LANE } from './bunch';
import { RIDE } from './look.test-helper';
import { LANE } from './bunch';
import { compose } from './compose';
import { routeOfRoad } from './road-route';
import type { Hud } from './compose';
import type { RideMetre } from './sim';
import { ROAD_W } from './terrain/road-profile';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';
import type { Route } from '$lib/road/route';

/**
 * A ride's world is this ride (#3663): one figure, yours, standing where the
 * ride says you are on its road — the world moves nobody of its own.
 */

const style = RIDE;
let route: Route;
let world: World;
beforeAll(() => {
	route = routeOfRoad(legsRoad([1500, 2], [1500, 6], [1000, 0]));
	world = generate(route);
}, BUILD_MS);

const figures = (scene: THREE.Scene) => {
	let n = 0;
	scene.traverse((o) => {
		if (o.userData.family === 'figures') n++;
	});
	return n;
};

describe('a ride’s world', () => {
	it('holds one figure on a solo ride, yours', () => {
		const w = compose(
			{ route, world, style, ftp: 250, metre: () => ({ m: 0, mps: 0 }) },
			null,
		);
		expect(figures(w.scene)).toBe(1);
		w.dispose();
	});

	it('keeps you, riding alone, in the middle of the right lane', () => {
		const w = compose(
			{ route, world, style, ftp: 250, metre: () => ({ m: 1200, mps: 0 }) },
			null,
		);
		w.advanceBy(0.3);
		let you: THREE.Object3D | undefined;
		w.scene.traverse((o) => {
			if (!you && o.userData.family === 'figures') you = o;
		});
		const pos = you!.getWorldPosition(new THREE.Vector3());
		const p = at(route, 1200);
		const { lx, lz } = leftOf(p.heading);
		// Left of the road's centre is positive: the right lane's middle is a quarter of the road to the right.
		expect((pos.x - p.x) * lx + (pos.z - p.z) * lz).toBeCloseTo(-ROAD_W / 4, 1);
		// The chase eye rides your lane, so the lane leaves you inside RIDER_BOX (40–60 % across).
		w.camera.aspect = 1440 / 900;
		w.camera.updateProjectionMatrix();
		w.advanceBy(0.3);
		w.camera.updateMatrixWorld();
		const across = you!
			.getWorldPosition(new THREE.Vector3())
			.project(w.camera).x;
		expect((across + 1) / 2).toBeGreaterThan(RIDER_BOX.x0);
		expect((across + 1) / 2).toBeLessThan(RIDER_BOX.x1);
		w.dispose();
	});

	it('stands your figure on the ride’s metre, and follows it as the ride moves', () => {
		const ride: RideMetre = { m: 1200, mps: 0 };
		let km = NaN;
		const w = compose(
			{
				route,
				world,
				style,
				ftp: 250,
				metre: () => ride,
				onTick: (hud) => (km = hud.km),
			},
			null,
		);
		w.advanceBy(0.3);
		expect(km * 1000).toBeCloseTo(1200, 0);
		// A second at 8 m/s: the figure rolls on at the ride's speed, then settles on its next metre.
		ride.mps = 8;
		for (let f = 0; f < 30; f++) w.advanceBy(1 / 30);
		ride.m = 1208;
		for (let f = 0; f < 30; f++) w.advanceBy(1 / 30);
		expect(km * 1000).toBeGreaterThan(1208);
		expect(km * 1000).toBeLessThan(1208 + 8 + 0.5);
		// Its own watts move nothing: the world tells the ride nothing and rides no pace of its own.
		ride.mps = 0;
		w.setWatts(600);
		for (let f = 0; f < 90; f++) w.advanceBy(1 / 30);
		expect(km * 1000).toBeCloseTo(1208, 0);
		w.dispose();
	});

	it('draws your trail as a thin line on the road behind you, never a wall', () => {
		const ride: RideMetre = { m: 900, mps: 0 };
		const w = compose(
			{ route, world, style, ftp: 250, metre: () => ride },
			null,
		);
		w.advanceBy(0.3);
		let trail: THREE.Mesh | null = null;
		w.scene.traverse((o) => {
			if (o.userData.kind === 'trail') trail = o as THREE.Mesh;
		});
		const pos = (trail as THREE.Mesh | null)!.geometry.attributes.position;
		const at = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, k);
		// Each row is a pair across the line, a wheel wide, level with each other.
		for (let k = 0; k < pos.count; k += 2) {
			expect(at(k).distanceTo(at(k + 1))).toBeCloseTo(0.08, 3);
			expect(Math.abs(at(k).y - at(k + 1).y)).toBeLessThan(1e-6);
		}
		// It lies along three metres of road behind the wheel: its fade ends inside the chase frame.
		const [first, last] = [at(0), at(pos.count - 2)];
		expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeGreaterThan(2.7);
		expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeLessThan(3.1);
		w.dispose();
	});

	it('stops your trail and takes your ring out of its zone while your trainer is silent, and gives both back with the next sample (#3766)', () => {
		const w = compose(
			{
				route,
				world,
				style,
				ftp: 250,
				watts: 300,
				metre: () => ({ m: 900, mps: 0 }),
			},
			null,
		);
		let trail: THREE.Mesh | undefined;
		let ring: THREE.Mesh | undefined;
		w.scene.traverse((o) => {
			if (o.userData.kind === 'trail') trail = o as THREE.Mesh;
			if (o instanceof THREE.Mesh && o.userData.kind === 'zone-ring') ring = o;
		});
		const tone = () =>
			`#${(ring!.material as THREE.MeshBasicMaterial).color.getHexString()}`;
		const zones = style.zones.map((z) => new THREE.Color(z).getHexString());
		w.advanceBy(0.3);
		expect(zones).toContain(tone().slice(1));
		expect(trail!.visible).toBe(true);

		w.setSilent(true);
		w.advanceBy(0.1);
		expect(zones).not.toContain(tone().slice(1));
		expect(trail!.visible).toBe(false);

		w.setSilent(false);
		w.advanceBy(0.1);
		expect(zones).toContain(tone().slice(1));
		expect(trail!.visible).toBe(true);
		w.dispose();
	});

	it('lays a bunch out by the wall’s time, however slowly its frames come (#3098)', () => {
		const where = (frame: number, wall: number) => {
			let tick = { m: 300, s: 0 };
			let hud: Hud | null = null;
			const w = compose(
				{
					route,
					world,
					style,
					ftp: 250,
					youId: 'a',
					metre: () => ({ m: tick.m, mps: 8 }),
					bunch: () => ({
						m: tick.m,
						mps: 8,
						elapsed: 30,
						order: ['a', 'b', 'c', 'd'],
						// b is towed back in, two metres a second: an offset on the move.
						offsets: { b: -40 + 2 * tick.s },
						resting: [],
						present: new Map(
							['a', 'b', 'c', 'd'].map((id) => [id, { watts: 200, ftp: 250 }]),
						),
						game: false,
						cheered: [],
					}),
					onTick: (next) => (hud = next),
				},
				null,
			);
			// Six seconds of the hub's whole-second ticks, drawn at this screen's frame rate.
			for (let t = 0; t < 6; t += wall) {
				if (Math.floor(t + wall) > Math.floor(t))
					tick = { m: tick.m + 8, s: tick.s + 1 };
				w.advanceBy(frame, wall);
			}
			w.dispose();
			return hud!.riders;
		};
		const fast = where(1 / 30, 1 / 30);
		// A screen drawing twice a second: each frame clamped to 0.1 s, as scene.ts clamps it.
		const slow = where(0.1, 0.5);
		// The two snapshots are taken a moment apart: compare where each rider is against the first.
		const gap = (list: Hud['riders'], id: string) =>
			list.find((x) => x.id === id)!.d - list.find((x) => x.id === 'a')!.d;
		for (const r of fast) {
			const s = slow.find((x) => x.id === r.id)!;
			expect(
				Math.abs(gap(slow, r.id) - gap(fast, r.id)),
				`${r.id} along the road`,
			).toBeLessThan(1);
			expect(Math.abs(s.lane - r.lane), `${r.id} across it`).toBeLessThan(0.1);
		}
	});

	it('draws a cheer for one rider over their head once, and blinks their tail light for 10 s (#3116)', () => {
		const run = (steady: boolean) => {
			// One tick carries the cheer; every frame reads its view until the next.
			let sent = 1000;
			const w = compose(
				{
					route,
					world,
					style,
					ftp: 250,
					youId: 'a',
					metre: () => ({ m: 300, mps: 8 }),
					steady: () => steady,
					bunch: () => ({
						m: 300,
						mps: 8,
						at: sent,
						elapsed: 30,
						order: ['a', 'b'],
						offsets: {},
						resting: [],
						present: new Map([
							['a', { watts: 200, ftp: 250 }],
							['b', { watts: 200, ftp: 250 }],
						]),
						game: false,
						cheered: sent === 1000 ? ['b'] : [],
					}),
				},
				null,
			);
			const seen = (kind: string) => {
				const over: string[] = [];
				w.scene.traverseVisible((o) => {
					if (o.userData.kind !== kind) return;
					let p: THREE.Object3D | null = o;
					while (p && !p.userData.rider) p = p.parent;
					over.push(p?.userData.rider);
				});
				return over;
			};
			const frames: { t: number; thumb: string[]; light: string[] }[] = [];
			for (let k = 0; k <= 12 * 30; k++) {
				// A second tick at 1 s that does not cheer: the cheer is not heard again.
				if (k === 30) sent = 2000;
				w.advanceBy(k ? 1 / 30 : 0);
				frames.push({
					t: k / 30,
					thumb: seen('cheer'),
					light: seen('tail-light'),
				});
			}
			w.dispose();
			return (t: number) => frames[Math.round(t * 30)];
		};
		const moving = run(false);
		expect(moving(0.1).thumb).toEqual(['b']);
		expect(moving(0.1).light).toEqual(['b']);
		// 2 Hz: off for the second quarter of each half-second.
		expect(moving(0.35).light).toEqual([]);
		expect(moving(0.6).light).toEqual(['b']);
		expect(moving(3).thumb).toEqual([]);
		expect(moving(9.6).light).toEqual(['b']);
		expect(moving(10.1).light).toEqual([]);
		expect(moving(11).thumb).toEqual([]);
		// Reduced motion: a held stamp, the light lit throughout.
		const steady = run(true);
		expect(steady(0.35).light).toEqual(['b']);
		expect(steady(9.6).light).toEqual(['b']);
		expect(steady(10.1).light).toEqual([]);
	});

	it('rings each rider whose numbers you may see, a thin flat band, and tags the nearest by name (#3086)', () => {
		const drawn = (meterHidden: boolean, bPresent = true) => {
			const present = new Map([
				['a', { watts: 200, ftp: 250, name: 'Ana' }],
				['b', { watts: 150, ftp: 250, name: 'Ben', level: 12 }],
			]);
			if (!bPresent) present.delete('b');
			const w = compose(
				{
					route,
					world,
					style,
					ftp: 250,
					youId: 'a',
					metre: () => ({ m: 300, mps: 8 }),
					bunch: () => ({
						m: 300,
						mps: 8,
						elapsed: 30,
						order: ['a', 'b'],
						offsets: {},
						resting: [],
						present,
						game: false,
						cheered: [],
						meterHidden,
					}),
				},
				null,
			);
			for (let k = 0; k < 30; k++) w.advanceBy(1 / 30);
			const bands: number[] = [];
			const widths: number[] = [];
			const additive: string[] = [];
			const tags: string[] = [];
			w.scene.traverseVisible((o) => {
				const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
				if (o.userData.kind === 'zone-ring') {
					// Across the road, where the band crosses the x axis: outer less inner.
					const xs: number[] = [];
					const pos = m.geometry.getAttribute('position');
					for (let i = 0; i < pos.count; i++)
						if (Math.abs(pos.getZ(i)) < 1e-6) xs.push(Math.abs(pos.getX(i)));
					bands.push(Math.max(...xs) - Math.min(...xs));
					widths.push(2 * Math.max(...xs));
				}
				if (
					m.material &&
					'blending' in m.material &&
					m.material.blending === THREE.AdditiveBlending
				)
					additive.push(o.userData.kind);
				if (o.userData.kind === 'name-tag') tags.push(o.userData.text);
			});
			w.dispose();
			return { bands, widths, additive, tags };
		};
		const both = drawn(false);
		// Yours and your crewmate's, each one band a wheel wide.
		expect(both.bands).toHaveLength(2);
		for (const b of both.bands) expect(b).toBeCloseTo(0.08, 6);
		// Narrower than the lane between riders abreast: two rings never cross.
		for (const w of both.widths) expect(w).toBeLessThan(LANE);
		// Never over you; the rider beside you, by name and level.
		expect(both.tags).toEqual(['Ben · Lv 12']);
		// Your trail stays the only glow.
		expect(both.additive).toEqual(['trail']);
		// A game that hides the meter hides every ring; a faded rider wears none.
		expect(drawn(true).bands).toHaveLength(0);
		expect(drawn(false, false).bands).toHaveLength(1);
	});

	/** Backyard Ramp with b put out at 300 m; `ride(s)` rides s seconds, a tick a second at 8 m/s, drawn at 30 fps. */
	function backyardRide() {
		let tick = { m: 300, s: 0 };
		const cues: string[] = [];
		let hud: Hud | null = null;
		const w = compose(
			{
				route,
				world,
				style,
				ftp: 250,
				youId: 'a',
				metre: () => ({ m: tick.m, mps: 8 }),
				onCue: (cue) => cues.push(cue),
				onTick: (next) => (hud = next),
				bunch: () => ({
					m: tick.m,
					mps: 8,
					at: tick.s * 1000,
					elapsed: tick.s,
					order: ['a', 'b'],
					offsets: {},
					resting: [],
					present: new Map([
						['a', { watts: 200, ftp: 250 }],
						['b', { watts: 125, ftp: 250 }],
					]),
					game: true,
					cheered: [],
					play: { mode: 'backyard-ramp', round: 2, out: ['b'] },
				}),
			},
			null,
		);
		const ride = (seconds: number) => {
			for (let k = 1; k <= seconds * 30; k++) {
				if (k % 30 === 0) tick = { m: tick.m + 8, s: tick.s + 1 };
				w.advanceBy(1 / 30);
			}
		};
		return { w, cues, ride, b: () => hud!.riders.find((r) => r.id === 'b')! };
	}

	it('rings the cowbell under the roadside ceiling: with the minute’s sounds spent, the bunch passes in silence (#3114)', () => {
		// An hour back, so the page's one ceiling, rung out by the crowd there,
		// has forgotten it when the clock returns for the next test.
		vi.setSystemTime(Date.now() - 3_600_000);
		try {
			for (let i = 0; i < ROADSIDE_SOUNDS_PER_MINUTE; i++)
				roadsideSound(Date.now());
			const { w, cues, ride } = backyardRide();
			ride(41);
			expect(cues).toEqual([]);
			w.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it('stands a rider a game put out on the verge ahead, and rings the cowbell as the bunch rides by (#3114)', () => {
		const { w, cues, ride, b } = backyardRide();
		ride(1);
		const stand = b().d;
		// No hairpin on this road within 5 km: 300 m ahead of where they went out.
		expect(stand).toBeCloseTo(300 + 300, 0);
		expect(b().lane).toBeCloseTo(VERGE_LANE, 2);
		expect(cues).toEqual([]);
		ride(40);
		// Ridden past once: one ring.
		expect(cues).toEqual(['cowbell']);
		w.dispose();
	});

	it('chalks the roadside’s stamps on the bunch’s road, and drops them once ridden over (#3029)', () => {
		let chalk = [{ key: 'kim@900', stamp: 'heart', letter: '', u: 900 }];
		const w = compose(
			{
				route,
				world,
				style,
				ftp: 250,
				youId: 'a',
				metre: () => ({ m: 300, mps: 8 }),
				bunch: () => ({
					m: 300,
					mps: 8,
					elapsed: 30,
					order: ['a'],
					offsets: {},
					resting: [],
					present: new Map([['a', { watts: 200, ftp: 250 }]]),
					game: false,
					cheered: [],
					chalk,
				}),
			},
			null,
		);
		const stamps = () => {
			let n = 0;
			w.scene.traverseVisible((o) => {
				if (o.userData.kind === 'chalk') n++;
			});
			return n;
		};
		w.advanceBy(1 / 30);
		expect(stamps()).toBe(1);
		chalk = [];
		w.advanceBy(1 / 30);
		expect(stamps()).toBe(0);
		w.dispose();
	});

	it('draws a coach with no trainer as the team car: one chevron, no figure of their own (#3771)', () => {
		const drawn = (coachRests: boolean) => {
			const w = compose(
				{
					route,
					world,
					style,
					ftp: 250,
					youId: 'coach',
					metre: () => ({ m: 300, mps: 8 }),
					bunch: () => ({
						m: 300,
						mps: 8,
						elapsed: 30,
						order: ['coach', 'a'],
						offsets: {},
						resting: coachRests ? ['coach'] : [],
						coach: 'coach',
						present: new Map([
							['coach', { watts: coachRests ? 0 : 200, ftp: 250 }],
							['a', { watts: 200, ftp: 250 }],
						]),
						game: false,
						cheered: [],
					}),
				},
				null,
			);
			for (let k = 0; k < 30; k++) w.advanceBy(1 / 30);
			let chevrons = 0;
			let figures = 0;
			w.scene.traverseVisible((o) => {
				if (o.userData.kind === 'chevron') chevrons++;
				else if (o.userData.family === 'figures' && o.userData.kind !== 'car')
					figures++;
			});
			w.dispose();
			return { chevrons, figures };
		};
		const riding = drawn(false);
		const driving = drawn(true);
		// Riding: the coach's chevron over their own figure, and two figures.
		expect(riding.chevrons).toBe(1);
		// Driving: the chevron rides on the car, and only the crewmate is drawn.
		expect(driving.chevrons).toBe(1);
		expect(driving.figures).toBe(riding.figures / 2);
	});
});
