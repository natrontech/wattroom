import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import type { Route } from '#lib/road/route.ts';
import { road } from './geometry';
import { roadPieces } from './ground-stream';
import { routeOfRoad } from './road-route';
import { ribbonRows, ringOf, rowCount, SHOULDER } from './terrain/road-profile';

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
		expect(rowsOf(road(route, { shoulder: SHOULDER }))).toBe(rowCount(route));
	});
});
