import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { at } from '#lib/road/along.ts';
import {
	alpineLoop,
	hairpinClimb,
	OUT_AND_BACK_APART,
	OUT_AND_BACK_STREET,
	outAndBack,
	switchback,
} from '#lib/road/fixtures.ts';
import type { Road } from '#lib/road/road.ts';
import { toRoute, type Route } from '#lib/road/route.ts';
import { road } from './geometry';
import { roadPieces } from './ground-stream';
import { routeOfRoad } from './road-route';
import { BLEND_M } from './shared-road';
import { SHOULDER } from './terrain/road-profile';

/**
 * A road the route rides twice, drawn once (#4531): a route out and back
 * along one street carries two GPS traces of it a few metres apart, and the
 * world drew both, two ribbons braided with grass between them. The later
 * pass is drawn on the earlier; the ride's metres and grades stay as
 * recorded. Made-up roads only: no real route enters a test.
 */

/** The world's road as a ride builds it: from the road's heights and turns (RideWorld.svelte). */
const walked = (r: Road) => routeOfRoad(r);
const street = walked(toRoute(outAndBack()).road);

/** The same, drawn as recorded: every pass its own, as the world drew it before #4531. */
const recorded = (r: Road): Route => routeOfRoad(r, false);

const xz = (p: { x: number; z: number }): [number, number] => [p.x, p.z];

/** The nearest point of the way out, its first OUT_AND_BACK_STREET metres, to (x, z): how far, and its height. */
function outAt(r: Route, x: number, z: number) {
	let best = { d: Infinity, ele: 0 };
	for (let m = 0; m < OUT_AND_BACK_STREET; m += 0.2) {
		const p = at(r, m);
		const d = Math.hypot(p.x - x, p.z - z);
		if (d < best.d) best = { d, ele: p.ele };
	}
	return best;
}

/** How many layers of visible ribbon lie over the point (x, z), seen from above. */
function layers(g: THREE.BufferGeometry, x: number, z: number): number {
	const p = g.attributes.position.array;
	const idx = g.index!.array;
	let n = 0;
	for (let k = 0; k < idx.length; k += 3) {
		const [a, b, c] = [idx[k] * 3, idx[k + 1] * 3, idx[k + 2] * 3];
		const side = (i: number, j: number) =>
			(p[j] - p[i]) * (z - p[i + 2]) - (p[j + 2] - p[i + 2]) * (x - p[i]);
		const s1 = side(a, b);
		const s2 = side(b, c);
		const s3 = side(c, a);
		if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) n++;
	}
	return n;
}

describe('a street ridden out and back', () => {
	it('is drawn as one road where it is ridden twice', () => {
		const before = road(recorded(toRoute(outAndBack()).road), {
			shoulder: SHOULDER,
		});
		const after = road(street, { shoulder: SHOULDER });
		// Along the street, on the way out's centreline: two ribbons before, one now.
		for (let d = 400; d <= OUT_AND_BACK_STREET - 400; d += 200) {
			const p = at(street, d);
			expect(layers(before, p.x, p.z), `${d} m out`).toBe(2);
			expect(layers(after, p.x, p.z), `${d} m out`).toBe(1);
		}
		// Off the shared street, the lollipop is drawn as ever, once.
		const loop = at(street, OUT_AND_BACK_STREET + 300);
		expect(layers(after, loop.x, loop.z)).toBe(1);
	});

	it('draws the way back on the way out, where the rider rides it', () => {
		// The way back lay beside the way out, as recorded; now on it, its rider with it.
		const was = recorded(toRoute(outAndBack()).road);
		const apart: number[] = [];
		for (let d = 400; d <= OUT_AND_BACK_STREET - 400; d += 100) {
			const b = at(street, street.length - d);
			const o = outAt(street, b.x, b.z);
			apart.push(outAt(was, ...xz(at(was, was.length - d))).d);
			expect(o.d, `${d} m from the end`).toBeLessThan(0.3);
			expect(Math.abs(b.ele - o.ele), `${d} m from the end`).toBeLessThan(0.2);
		}
		expect(Math.min(...apart)).toBeGreaterThan(OUT_AND_BACK_APART - 1);
	});

	it('keeps the ride as recorded: the same metres at the same grades', () => {
		const was = recorded(toRoute(outAndBack()).road);
		expect(street.length).toBe(was.length);
		expect(street.step).toBe(was.step);
		expect(Array.from(street.grade)).toEqual(Array.from(was.grade));
	});

	it('eases onto it, never a kink, and ends on it', () => {
		// The way back joins the street 20° off it, round the lollipop: easing on, each 10 m turns at most a few degrees more than the recorded way did.
		const was = recorded(toRoute(outAndBack()).road);
		const turn = (r: Route, d: number) => {
			let a = at(r, d + 10).heading - at(r, d).heading;
			while (a > Math.PI) a -= 2 * Math.PI;
			while (a < -Math.PI) a += 2 * Math.PI;
			return (a * 180) / Math.PI;
		};
		const from = street.length - OUT_AND_BACK_STREET - 3 * BLEND_M;
		// The last 30 m bend to the start as a loop's smoothing bends them (toRoute), the way out's first metres with them.
		for (let d = from; d < street.length - 30; d += 5)
			expect(
				Math.abs(turn(street, d) - turn(was, d)),
				`${Math.round(d)} m`,
			).toBeLessThan(6);
		// A route that ends on the street ends on the way out's start, not beside it.
		const end = at(street, street.length);
		expect(outAt(street, end.x, end.z).d).toBeLessThan(0.5);
	});

	it('streams the pieces of the way back as the whole draws them', () => {
		const whole = road(street, { shoulder: SHOULDER });
		const cols = 5;
		const rows = (g: THREE.BufferGeometry, from: number, to: number) =>
			Array.from(
				g.attributes.position.array.slice(from * cols * 3, (to + 1) * cols * 3),
			);
		for (const { rows: r } of roadPieces(street)) {
			const piece = road(street, { shoulder: SHOULDER, rows: r });
			expect(rows(piece, 0, r[1] - r[0])).toEqual(rows(whole, r[0], r[1]));
		}
	});
});

describe('a route that never rides a road twice', () => {
	const fixtures: [string, () => Promise<Road>][] = [
		...HOME_ROADS.map(
			(h) =>
				[h.name, async () => (await homeRoute(h)).road] as [
					string,
					() => Promise<Road>,
				],
		),
		['the Alpine loop', async () => alpineLoop()],
		['21 hairpins', async () => toRoute(hairpinClimb()).road],
		['a switchback', async () => toRoute(switchback()).road],
	];

	it.each(fixtures)('%s builds exactly what it built', async (_, made) => {
		const r = await made();
		const route = walked(r);
		expect(route.shared).toBeUndefined();
		expect(route).toEqual(recorded(r));
		const ribbon = (q: Route) =>
			Array.from(road(q, { shoulder: SHOULDER }).attributes.position.array);
		expect(ribbon(route)).toEqual(ribbon(recorded(r)));
	});
});
