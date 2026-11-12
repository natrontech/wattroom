import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { at } from '#lib/road/along.ts';
import {
	alpineLoop,
	hairpinClimb,
	HOME_STREET,
	homeStreet,
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
import { BLEND_M, WIDE_M } from './shared-road';
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

describe('a loop home along a street two GPS traces lie apart on', () => {
	// The way home lies 4 m off by the door, 15 m off for 330 m past a jog, round a block 120 m off, then 5–13 m: as a rider's own street measured.
	const was = recorded(toRoute(homeStreet()).road);
	const home = walked(toRoute(homeStreet()).road);
	/** The way home's metre beside metre `m` of the street, counted from the door: its recorded point nearest across. */
	const out = Array.from({ length: HOME_STREET + 1 }, (_, m) => at(was, m));
	const across: [d: number, m: number][] = [];
	for (let d = was.length - HOME_STREET - 400; d <= was.length; d += 5) {
		const p = at(was, d);
		let m = 0;
		for (let k = 1; k < out.length; k++)
			if (
				Math.hypot(out[k].x - p.x, out[k].z - p.z) <
				Math.hypot(out[m].x - p.x, out[m].z - p.z)
			)
				m = k;
		across.push([d, m]);
	}
	const homeAt = (m: number) =>
		across.reduce((a, b) =>
			Math.abs(b[1] - m) < Math.abs(a[1] - m) ? b : a,
		)[0];
	const near = (r: Route, d: number) => {
		const p = at(r, d);
		let best = Infinity;
		for (let m = 0; m < HOME_STREET; m += 0.5) {
			const q = at(r, m);
			best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z));
		}
		return best;
	};

	it('draws the way home on the way out, both the near and the wide stretches', () => {
		for (const m of [100, 300, 450, 550, 1200, 1500, 1700, 1900]) {
			expect(near(was, homeAt(m)), `${m} m as recorded`).toBeGreaterThan(2.5);
			expect(near(home, homeAt(m)), `${m} m`).toBeLessThan(0.3);
		}
		// Where it was 15 m off, there was grass between two roads; now one road.
		expect(near(was, homeAt(550))).toBeGreaterThan(2 * SHOULDER + 6.4);
		const after = road(home, { shoulder: SHOULDER });
		for (const m of [300, 550, 1500]) {
			const p = at(home, m);
			expect(layers(after, p.x, p.z), `${m} m out`).toBe(1);
		}
	});

	it('keeps the detour round the block its own road', () => {
		const d = homeAt(865);
		expect(near(was, d)).toBeGreaterThan(100);
		expect(xz(at(home, d))).toEqual(xz(at(was, d)));
		expect(home.shared![Math.round(d / home.step)]).toBe(0);
	});

	it('eases on and off along the street with no kink', () => {
		const turn = (r: Route, d: number) => {
			let a = at(r, d + 10).heading - at(r, d).heading;
			while (a > Math.PI) a -= 2 * Math.PI;
			while (a < -Math.PI) a += 2 * Math.PI;
			return Math.abs((a * 180) / Math.PI);
		};
		// Easing on and off, a jog across 11 m included, never bends the way home more than 6° per 10 m beyond its own bends, a bend of 100 m radius: a road joining another.
		for (let d = homeAt(HOME_STREET); d < home.length - 30; d += 5)
			expect(
				turn(home, d),
				`${Math.round(home.length - d)} m from the door`,
			).toBeLessThan(turn(was, d) + 6);
	});

	it('keeps the ride as recorded', () => {
		expect(home.length).toBe(was.length);
		expect(Array.from(home.grade)).toEqual(Array.from(was.grade));
	});

	it('keeps a road beside it, three road widths off and more, its own', () => {
		const off = WIDE_M + 6;
		const beside = toRoute(
			homeStreet((m) => (m < 40 ? (off * m) / 40 : off)),
		).road;
		const route = walked(beside);
		expect(route.shared).toBeUndefined();
		expect(route).toEqual(recorded(beside));
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
