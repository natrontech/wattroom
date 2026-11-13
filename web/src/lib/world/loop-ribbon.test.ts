import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import type { Route } from '#lib/road/route.ts';
import { CAP_ROWS, road } from './geometry';
import { roadPieces } from './ground-stream';
import { routeOfRoad } from './road-route';
import {
	endsMeet,
	FORMATION,
	ribbonRows,
	ringOf,
	rowCount,
	SHOULDER,
} from './terrain/road-profile';

/**
 * A loop's road at its start line (#4534): a voice channel's free ride
 * stands there before the first pedal stroke, and the ribbon was an open
 * strip whose last row stopped short of its first (0.9 m on the Pass loop)
 * and turned on a one-sided tangent, so the ground showed between the two
 * ends right under the rider. A road that goes round is one strip round.
 */

const COLS = 5;
/** Row `k` of `g`'s attribute `name`. */
const row = (g: THREE.BufferGeometry, name: string, k: number) => {
	const { array, itemSize } = g.attributes[name];
	const per = COLS * itemSize;
	return Array.from(array.slice(k * per, (k + 1) * per));
};
const rowsOf = (g: THREE.BufferGeometry) => g.attributes.position.count / COLS;

describe.each(HOME_ROADS.map((r) => [r.name, r] as const))(
	'the %s, as its ride draws it',
	(_, home) => {
		/** The stage draws the road as it is, lapped or not (compose.ts): never with `loop` set. */
		const walked = async () => routeOfRoad((await homeRoute(home)).road);

		it('is one strip round: its last cross-section is its first, lit alike', async () => {
			const route = await walked();
			expect(ringOf(route)).toBe(true);
			const whole = road(route, { shoulder: SHOULDER });
			const last = rowsOf(whole) - 1;
			for (const name of ['position', 'normal'])
				expect(row(whole, name, last), name).toEqual(row(whole, name, 0));
		});

		it('runs on across the start line, never back over itself', async () => {
			const route = await walked();
			const whole = road(route, { shoulder: SHOULDER });
			const n = rowsOf(whole);
			const centre = (k: number) => row(whole, 'position', k).slice(6, 9);
			// Each row past the one before along the way the road runs, the last step no longer than a step and a half.
			for (const k of [n - 4, n - 3, n - 2, n - 1, 1, 2]) {
				const [ax, , az] = centre(k - 1);
				const [bx, , bz] = centre(k);
				const [cx, , cz] = centre(k === n - 1 ? 1 : k + 1);
				const along = (bx - ax) * (cx - bx) + (bz - az) * (cz - bz);
				expect(along).toBeGreaterThan(0);
				expect(Math.hypot(bx - ax, bz - az)).toBeGreaterThan(0.5);
				expect(Math.hypot(bx - ax, bz - az)).toBeLessThanOrEqual(3);
			}
		});

		it('streams its last piece onto its first, as the whole draws them', async () => {
			const route = await walked();
			const whole = road(route, { shoulder: SHOULDER });
			const pieces = roadPieces(route);
			const [first, last] = [pieces[0], pieces.at(-1)!];
			expect(last.rows[1]).toBe(rowsOf(whole) - 1);
			const draw = (rows: [number, number]) =>
				road(route, { shoulder: SHOULDER, rows });
			const head = draw(first.rows);
			const tail = draw(last.rows);
			const end = last.rows[1] - last.rows[0];
			for (const name of ['position', 'normal', 'uv']) {
				expect(row(head, name, 0), name).toEqual(row(whole, name, 0));
				expect(row(tail, name, end), name).toEqual(
					row(whole, name, rowsOf(whole) - 1),
				);
			}
			expect(row(tail, 'position', end)).toEqual(row(head, 'position', 0));
		});
	},
);

/** A straight road out and a turn back 6 m beside it, 201 samples 10 m apart: its end lies 6 m from its start, facing the other way. */
function outAndBack(): Route {
	const x: number[] = [];
	const z: number[] = [];
	for (let k = 0; k <= 100; k++) (x.push(0), z.push(-k * 10));
	for (let k = 99; k >= 0; k--) (x.push(6), z.push(-k * 10));
	const n = x.length;
	return {
		step: 10,
		length: 2000,
		loop: true,
		x: Float64Array.from(x),
		z: Float64Array.from(z),
		ele: new Float64Array(n),
		grade: new Float64Array(n),
		minEle: 0,
	} as unknown as Route;
}

describe('a road with two ends', () => {
	it('keeps them, though they lie side by side: an out-and-back turns at its start', () => {
		const route = outAndBack();
		expect(ringOf(route)).toBe(false);
		const rows = ribbonRows(route);
		expect(rows.ring).toBe(false);
		expect(rows.count).toBe(rowCount(route));
		// Its own rows, and each end's rounded off after them.
		expect(rowsOf(road(route, { shoulder: SHOULDER }))).toBe(
			rowCount(route) + 2 * CAP_ROWS,
		);
	});

	it('rounds each end off: the edge and the shoulder run round it to a point a formation beyond', () => {
		const route = outAndBack();
		const g = road(route, { shoulder: SHOULDER });
		const count = rowCount(route);
		// After the road's rows: the start's cap from its tip in to the start row, then the end's from the end row out.
		const tip = row(g, 'position', count);
		const start = row(g, 'position', 0);
		expect(row(g, 'position', count + CAP_ROWS - 1)).toEqual(start);
		// Every column meets at the tip, a formation's width beyond the row's centre.
		const off = (p: number[], c: number, q: number[]) =>
			Math.hypot(p[c * 3] - q[2 * 3], p[c * 3 + 2] - q[2 * 3 + 2]);
		for (let c = 0; c < COLS; c++)
			expect(off(tip, c, start)).toBeCloseTo(FORMATION, 4);
		const endTip = row(g, 'position', count + 2 * CAP_ROWS - 1);
		const end = row(g, 'position', count - 1);
		expect(off(endTip, 2, end)).toBeCloseTo(FORMATION, 4);
		// Beyond the road, not back along it.
		const next = row(g, 'position', 1);
		expect(off(tip, 2, next)).toBeGreaterThan(off(start, 2, next));
		// Painted as the end row is, metre for metre across.
		expect(row(g, 'uv', count).filter((_, i) => i % 2 === 0)).toEqual(
			row(g, 'uv', 0).filter((_, i) => i % 2 === 0),
		);
	});

	it('is one place where its ends meet, whichever way it comes home', () => {
		expect(endsMeet(outAndBack())).toBe(true);
		const open = outAndBack();
		expect(endsMeet({ ...open, x: open.x.map((v, k) => v + k) })).toBe(false);
	});
});
