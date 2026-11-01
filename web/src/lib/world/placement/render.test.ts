// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { at, curvature, leftOf } from '$lib/road/along';
import { toRoute } from '$lib/road/route';
import { STYLES } from '../test-styles';
import { CAMERA } from '../camera';
import { exponentialFog, propVisibility, terrainVisibility } from '../fog';
import { ROAD_LIFT, yOf } from '../geometry';
import { RIDE } from '../look.test-helper';
import { FAMILY, FAR_M, FETCH_AHEAD, NEAR_M } from '../props/batch';
import { kitSpec, type KitKind } from '../props/kit';
import { TILE_M } from '../props/tiles';
import { LEAVE } from '../ground-stream';
import { makeRig } from '../rig';
import type { SimRider } from '../sim';
import { DRESS_M } from '../stage';
import { ROAD_W } from '../terrain/road-profile';
import { syntheticPoints } from '../synthetic';
import type { World } from '../world';
import type { P2 } from './geom';
import {
	depthStep,
	fightsFrom,
	hits,
	pixels,
	RENDER_GATES as R,
	separatedTo,
	type Prism,
	type Pt,
} from './render';
import { rect } from './fixtures.test-helper';

/**
 * #3220: the render gates, each run on the world's own constants and each
 * seen red on the mutant it names (near 0.5, two fog formulas, a flagpole in
 * the low set, a prop on the road's sightline).
 */
// What the shoulder edge sits above the ground it is drawn beside, measured in #3078.
const SHOULDER_EDGE_M = 0.19;
// The shoulder holds its four depth steps through the near ring, and does not fight outright before this.
const SHOULDER_FIGHT_FROM_M = 1500;

const depth = (near: number) => {
	const out: string[] = [];
	if (near < R.nearMin) out.push(`near ${near} < ${R.nearMin} m`);
	if (separatedTo(SHOULDER_EDGE_M, near) < NEAR_M)
		out.push(`shoulder edge closer than 4 steps inside ${NEAR_M} m`);
	if (fightsFrom(SHOULDER_EDGE_M, near) < SHOULDER_FIGHT_FROM_M)
		out.push(
			`shoulder edge z-fights from ${Math.round(fightsFrom(SHOULDER_EDGE_M, near))} m`,
		);
	return out;
};

describe('O6 depth separation', () => {
	it('the camera near plane holds the shoulder edge apart', () => {
		expect(depth(CAMERA.near)).toEqual([]);
	});

	it('goes red at near 0.5: 0.12 m of depth resolution at 1 km, a shoulder that fights from 1.26 km', () => {
		expect(depthStep(1000, 0.5)).toBeCloseTo(0.12, 2);
		expect(Math.round(fightsFrom(SHOULDER_EDGE_M, 0.5))).toBe(1262);
		expect(depth(0.5)).toHaveLength(2);
	});
});

describe('O8 fog parity', () => {
	const ks = [RIDE.fogK, ...STYLES.map((s) => s.fogK)];
	const worst = (visible: (d: number, k: number) => number) =>
		Math.max(
			...ks.flatMap((k) =>
				Array.from({ length: 151 }, (_, i) =>
					Math.abs(visible(i * 100, k) - terrainVisibility(i * 100, k)),
				),
			),
		);

	it('props and terrain differ by at most 0.02 from 0 to 15 km in every look', () => {
		exponentialFog();
		expect(worst(propVisibility)).toBeLessThanOrEqual(0.02);
	});

	it('goes red on three’s squared exponent, and on a 1.1 × density', () => {
		const chunk = THREE.ShaderChunk.fog_fragment;
		THREE.ShaderChunk.fog_fragment = chunk.replace(
			'fogDensity * vFogDepth',
			'fogDensity * fogDensity * vFogDepth * vFogDepth',
		);
		try {
			expect(worst(propVisibility)).toBeGreaterThan(0.1);
		} finally {
			THREE.ShaderChunk.fog_fragment = chunk;
		}
		expect(worst((d, k) => propVisibility(d, k * 1.1))).toBeGreaterThan(0.02);
	});
});

const heightOf = (kind: string) =>
	kitSpec((kind.startsWith('flag') ? 'flag' : kind) as KitKind).height;
const fadeClass = (family: Record<string, string>) =>
	Object.keys(family).filter(
		(k) => heightOf(k) > R.fadeOverM && family[k] === 'stock',
	);

describe('O7 fade class', () => {
	it('every kit over 2.0 m is drawn through the dither fade, by its geometry', () => {
		expect(fadeClass(FAMILY)).toEqual([]);
	});

	it('goes red on a flagpole in the low set', () => {
		expect(fadeClass({ ...FAMILY, flag0: 'stock' })).toEqual(['flag0']);
	});
});

describe('O7 sightline, with the real rig', () => {
	const route = toRoute(syntheticPoints());
	const rig = makeRig(route, {
		heightAt: () => 0,
		markers: [],
	} as unknown as World);
	// What a kind needs from the road's edge (docs/SPEC.md O1): buildings 8 m, kits 6 m, snow poles and delineators on the verge.
	const edge = (k: string) =>
		['house', 'church', 'barn', 'hut', 'chapel'].includes(k)
			? 8
			: ['snowpole', 'delineator'].includes(k)
				? 0.3
				: 6;

	/** One of every kind at its nearest legal clearance every 24 m of road: alternating sides, the outside of a tight bend. */
	function lined(from: number, to: number, family: Record<string, string>) {
		const kinds = Object.keys(FAMILY);
		const out: Prism[] = [];
		for (let d = from, i = 0; d < to; d += 24, i++) {
			const kind = kinds[i % kinds.length];
			const p = at(route, d);
			const { lx, lz } = leftOf(p.heading);
			// Tall kit on a bend tighter than 500 m stands on its outside: inside it stands on the chord.
			const k = curvature(route, Math.round(d / route.step));
			const side = Math.abs(k) > 0.002 ? -Math.sign(k) : i % 2 ? 1 : -1;
			const off = side * (ROAD_W / 2 + edge(kind) + kitSpec(kindOf(kind)).hw);
			const s = kitSpec(kindOf(kind));
			out.push({
				id: `${kind}@${d}`,
				footprint: rect(
					p.x + lx * off,
					p.z + lz * off,
					2 * s.hw,
					2 * s.hd,
					-p.heading,
				) as P2[],
				base: yOf(route, p.ele),
				top: yOf(route, p.ele) + s.height,
				fades: family[kind] !== 'stock',
			});
		}
		return out;
	}
	const kindOf = (k: string) => (k.startsWith('flag') ? 'flag' : k) as KitKind;

	/** The frames, every 2 m of a stretch, in which each sightline is blocked. */
	function frames(prisms: Prism[], from: number, to: number) {
		const rider = { d: 0, v: 8 } as SimRider;
		const camera = new THREE.PerspectiveCamera(
			50,
			1.6,
			CAMERA.near,
			CAMERA.far,
		);
		const you = new THREE.Vector3();
		const bad = { rider: 0, near: 0, far: 0, n: 0, far150: 0 };
		const near = (a: Pt) =>
			prisms.filter(
				(p) =>
					Math.hypot(p.footprint[0][0] - a[0], p.footprint[0][1] - a[2]) < 200,
			);
		for (let d = from; d < to; d += R.everyM) {
			const p = at(route, d);
			const lane = -ROAD_W / 4;
			const { lx, lz } = leftOf(p.heading);
			you.set(p.x + lx * lane, yOf(route, p.ele) + ROAD_LIFT, p.z + lz * lane);
			rider.d = d;
			rig.reset();
			rig.update(camera, 'chase', rider, you, 1);
			const eye: Pt = [camera.position.x, camera.position.y, camera.position.z];
			const mine = near(eye);
			const chest: Pt = [you.x, you.y + 1, you.z];
			if (hits(eye, chest, mine).some((h) => !h.fades)) bad.rider++;
			const road = (m: number): Pt => {
				const q = at(route, d + m);
				return [
					q.x + lx * lane,
					yOf(route, q.ele) + ROAD_LIFT,
					q.z + lz * lane,
				];
			};
			for (const m of R.clearAhead)
				if (hits(eye, road(m), mine).length) {
					bad.near++;
				}
			for (const m of R.mostlyAhead)
				if (hits(eye, road(m), mine).length) bad.far++;
			bad.n++;
		}
		return bad;
	}
	// The hairpins and the descent: every bend radius the loop has.
	const [from, to] = [9400, 14000];

	it('hides the rider behind nothing that does not fade, and the road 20 and 40 m ahead behind nothing', () => {
		const bad = frames(lined(from, to, FAMILY), from, to);
		expect(bad.n).toBeGreaterThan(2000);
		expect(bad.rider).toBe(0);
		expect(bad.near).toBe(0);
	});

	it('hides the road 80 and 150 m ahead in at most 2 % of the frames', () => {
		const bad = frames(lined(from, to, FAMILY), from, to);
		expect(bad.far / (bad.n * R.mostlyAhead.length)).toBeLessThanOrEqual(
			R.mostlyShare,
		);
	});

	// A pole in the rider's lane, 8 m tall, one every `every` metres.
	const poles = (from: number, to: number, every: number): Prism[] => {
		const out: Prism[] = [];
		for (let d = from; d < to; d += every) {
			const p = at(route, d);
			const { lx, lz } = leftOf(p.heading);
			const base = yOf(route, p.ele);
			out.push({
				id: `pole@${d}`,
				footprint: rect(
					p.x - (lx * ROAD_W) / 4,
					p.z - (lz * ROAD_W) / 4,
					0.4,
					0.4,
					-p.heading,
				) as P2[],
				base,
				top: base + 8,
				fades: false,
			});
		}
		return out;
	};

	it('goes red on a pole in the rider’s lane: the rider hidden, the road 20 and 40 m ahead hidden', () => {
		const bad = frames(poles(9996, 9997, 1), 9980, 10020);
		expect(bad.rider).toBeGreaterThan(0);
		expect(bad.near).toBeGreaterThan(0);
	});

	it('goes red on a pole every 30 m: far road hidden in more than 2 % of the frames', () => {
		const bad = frames(poles(from, to, 30), from, to);
		expect(bad.far / (bad.n * R.mostlyAhead.length)).toBeGreaterThan(
			R.mostlyShare,
		);
	});
});

describe('O8 popping', () => {
	const kmh = R.maxKmh / 3.6;

	it('LOD and ring hysteresis are 10 % or more, shared with the ground', () => {
		expect(LEAVE).toBeGreaterThanOrEqual(R.hysteresis);
	});

	it('tiles are standing before the eye is within 1.2 × the fade distance', () => {
		expect(DRESS_M - 1.5 * TILE_M).toBeGreaterThanOrEqual(
			R.streamAhead * FAR_M,
		);
		expect(FETCH_AHEAD).toBeGreaterThanOrEqual(R.streamAhead);
		// A tile asked for one frame late: 80 km/h is under a metre a frame.
		expect(kmh / R.fps).toBeLessThan(1);
	});

	// Known red, reported on #3220: the far ring shows a tile in one frame, so a 27 m church appears at 12 px and a spruce at 7.
	it.fails('nothing appears in one frame over 3 px at the far ring', () => {
		const big = Object.keys(FAMILY).filter(
			(k) => pixels(heightOf(k), FAR_M) > R.popPx,
		);
		expect(big).toEqual([]);
	});

	// Known open, reported on #3220: the rings switch with setVisibleAt, so there is no fade or cross-fade to time.
	it.todo(
		'a ring change fades over at least 0.5 s, and an LOD swap cross-fades over 0.3 s',
	);

	it('measures a 27 m church at 12 px at the far ring, and a 2.5 m pole at 1', () => {
		expect(Math.round(pixels(27, FAR_M))).toBe(12);
		expect(Math.round(pixels(2.5, FAR_M))).toBe(1);
	});
});
