// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute, type Route } from '$lib/road/route';
import { WORLD_SALT } from '../place/network.test-helper';
import { unmatched, type Thing } from '../place/shared';
import { admit, crowd } from '../placement/check';
import type { P2 } from '../placement/geom';
import type { Placement, Road, Violation } from '../placement/types';
import { hashSeed } from '../rand';
import { syntheticPoints } from '../synthetic';
import { build, origin, routeLines } from '../terrain/network.test-helper';
import { drawnRows, ROAD_W, SHOULDER } from '../terrain/road-profile';
import { generate, type World } from '../world';
import { BUILD_MS } from '../world.test-helper';
import { FAMILY } from './batch';
import { scatter, type Prop } from './scatter';

/**
 * What stands beside the road (#3076): the same props in the same place
 * whichever route reaches it (#3226), and every one of them through #3219's
 * gates.
 */

const things = (props: Prop[]): Thing[] =>
	props.map((p) => ({
		kind: p.kind,
		frame: 'LV95',
		e: origin[0] + p.x,
		n: origin[1] - p.z,
	}));

function propsOf(lines: ReturnType<typeof routeLines.A>, salt = WORLD_SALT) {
	const w = build(lines, salt);
	return scatter({
		salt,
		origin,
		ground: w.ground,
		heightAt: w.terrain.heightAt,
		biomeAt: w.terrain.biomeAt,
		chunks: w.cover.chunks,
	}).props;
}

describe('the same place stands the same props (#3226)', () => {
	let A: Thing[];
	let B: Thing[];
	let C: Thing[];
	beforeAll(() => {
		A = things(propsOf(routeLines.A()));
		B = things(propsOf(routeLines.B()));
		C = things(propsOf(routeLines.C()));
	}, 60_000);

	it('stands a real crowd of them', () => {
		expect(A.length).toBeGreaterThan(500);
		expect(new Set(A.map((t) => t.kind)).size).toBeGreaterThanOrEqual(3);
	});

	it('matches every prop within 1 cm, whichever route asks', () => {
		expect(unmatched(A, B)).toBe(0);
		expect(unmatched(A, C)).toBe(0);
	});

	it(
		'would not, keyed by the route',
		() => {
			const byName = things(
				propsOf(routeLines.B(), [hashSeed('Toyjoch climb'), 1, 2, 3]),
			);
			expect(unmatched(A, byName)).toBeGreaterThan(A.length / 2);
		},
		BUILD_MS,
	);
});

/** The road as short overlapping stretches, and those near a footprint: O1 measured against all of it, cheaply. */
function roadsBy(points: readonly P2[]) {
	const pieces: { road: Road; box: [number, number, number, number] }[] = [];
	for (let a = 0; a < points.length - 1; a += 40) {
		const slice = points.slice(
			Math.max(0, a - 6),
			Math.min(points.length, a + 46),
		);
		const xs = slice.map((p) => p[0]);
		const zs = slice.map((p) => p[1]);
		pieces.push({
			road: { points: slice, halfWidth: ROAD_W / 2 },
			box: [
				Math.min(...xs) - 60,
				Math.min(...zs) - 60,
				Math.max(...xs) + 60,
				Math.max(...zs) + 60,
			],
		});
	}
	return (p: Placement) => {
		const [x, z] = p.footprint[0];
		return pieces
			.filter(({ box: [a, b, c, d] }) => x > a && x < c && z > b && z < d)
			.map((q) => q.road);
	};
}

describe('the dev world’s props', () => {
	let route: Route;
	let w: World;
	beforeAll(() => {
		route = toRoute(syntheticPoints());
		w = generate(route);
	}, 60_000);

	it('passes every gate: nothing on the road, nothing floating, sunk past its share or overlapping', () => {
		const near = roadsBy(drawnRows(route).map((p) => [p.x, p.z] as P2));
		const seen = crowd();
		const out: Violation[] = [];
		// Props and set pieces alike: road furniture stands on the ribbon where it is drawn.
		const drawn = (x: number, z: number) =>
			w.roadSurfaceAt(x, z) ?? w.heightAt(x, z);
		for (const p of w.placements) {
			out.push(...admit(p, near(p), drawn, seen));
			seen.add(p);
		}
		expect(w.placements.length).toBeGreaterThan(3000);
		expect(out).toEqual([]);
	});

	it('keeps the road and its shoulder clear of every tree and building, and every crown off a wall (#3675)', () => {
		// Every road, a point a metre, in 20 m buckets: near enough to a segment's distance.
		const CELL = 20;
		const buckets = new Map<string, P2[]>();
		for (const { x, z } of w.roads)
			for (let k = 0; k + 1 < x.length; k++) {
				const n = Math.ceil(Math.hypot(x[k + 1] - x[k], z[k + 1] - z[k]));
				for (let s = 0; s < n; s++) {
					const px = x[k] + ((x[k + 1] - x[k]) * s) / n;
					const pz = z[k] + ((z[k + 1] - z[k]) * s) / n;
					const key = `${Math.floor(px / CELL)},${Math.floor(pz / CELL)}`;
					buckets.set(key, [...(buckets.get(key) ?? []), [px, pz]]);
				}
			}
		const toRoad = (px: number, pz: number) => {
			let best = Infinity;
			const [ci, cj] = [Math.floor(px / CELL), Math.floor(pz / CELL)];
			for (let di = -1; di <= 1; di++)
				for (let dj = -1; dj <= 1; dj++)
					for (const [x, z] of buckets.get(`${ci + di},${cj + dj}`) ?? [])
						best = Math.min(best, Math.hypot(px - x, pz - z));
			return best;
		};
		const shoulder = ROAD_W / 2 + SHOULDER;
		const CROWN_M = 3;
		const trees = w.props.filter((p) => FAMILY[p.kind] === 'trees');
		const homes = w.placements
			.filter((p) => p.cls === 'building')
			.map(({ id, footprint: f }) => {
				const cx = f.reduce((s, [x]) => s + x, 0) / f.length;
				const cz = f.reduce((s, [, z]) => s + z, 0) / f.length;
				const r = Math.max(...f.map(([x, z]) => Math.hypot(x - cx, z - cz)));
				return { id, cx, cz, r };
			});
		expect(trees.length).toBeGreaterThan(3000);
		expect(homes.length).toBeGreaterThan(20);
		const onRoad = [
			...trees.map((t) => ({ id: t.kind, cx: t.x, cz: t.z, r: CROWN_M })),
			...homes,
		]
			.filter((p) => toRoad(p.cx, p.cz) <= shoulder + p.r)
			.map((p) => p.id);
		const atWalls = trees.filter((t) =>
			homes.some((h) => Math.hypot(t.x - h.cx, t.z - h.cz) <= h.r + CROWN_M),
		);
		expect(onRoad).toEqual([]);
		expect(atWalls.length).toBe(0);
	});

	it('builds each village around its church, and grazes cows', () => {
		const kinds = w.placements.map((p) => p.kind);
		expect(w.villageNames.length).toBeGreaterThanOrEqual(1);
		expect(kinds.filter((k) => k === 'church').length).toBe(
			w.villageNames.length,
		);
		expect(kinds.filter((k) => k === 'house').length).toBeGreaterThan(10);
		expect(kinds.filter((k) => k === 'cow').length).toBeGreaterThan(0);
	});
});
