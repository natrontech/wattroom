import { describe, expect, it } from 'vitest';
import { windingRoad, WINDING_RADII } from '#lib/road/fixtures.ts';
import { toRoute } from '#lib/road/route.ts';
import { road } from './geometry';
import { routeOfRoad } from './road-route';
import { banksOf, bendsOf } from './terrain/road-frame';
import { bankOf, drawnRows, SHOULDER } from './terrain/road-profile';

/**
 * The asphalt's shade on bends (#4556): on a recorded road, the Diorama's
 * banded light drew pale, wavy patches on asphalt the route rides once. The
 * asphalt's edges were lit with the shoulder's 13° drop, and a gentle bend's
 * bank swung 0–2.5° every 20 m with the line's wander. Made-up road only.
 */

/** The world's road as a ride builds it: walked from the road's heights and turns. */
const route = routeOfRoad(toRoute(windingRoad()).road);
const rows = drawnRows(route);
const xs = rows.map((p) => p.x);
const zs = rows.map((p) => p.z);
const COLS = 5;
const deg = (rad: number) => (rad * 180) / Math.PI;

/** Where each of WINDING_RADII's first bends lies, metres along the route: the middle of its arc. */
function bendMiddles(): number[] {
	let m = 300;
	return WINDING_RADII.map((r) => {
		const arc = ((r < 20 ? 180 : 70) * Math.PI * r) / 180;
		const middle = m + arc / 2;
		m += 2 * arc + 300;
		return middle;
	});
}

describe('the winding road, lit', () => {
	const g = road(route, { shoulder: SHOULDER });
	const n = g.attributes.normal.array;
	const normal = (r: number, c: number) => {
		const i = (r * COLS + c) * 3;
		return [n[i], n[i + 1], n[i + 2]] as const;
	};
	const angle = (
		a: readonly [number, number, number],
		b: readonly [number, number, number],
	) => deg(Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

	it('lights its asphalt as one surface, edge to edge', () => {
		let worst = 0;
		for (let r = 0; r < rows.length; r++)
			for (const c of [1, 3])
				worst = Math.max(worst, angle(normal(r, c), normal(r, 2)));
		// The shoulder's drop tilted the asphalt's edges 4.5–7° off its centre.
		expect(worst).toBeLessThan(0.05); // float32's rounding
	});

	it('tilts the asphalt by its bank across the road, and no more', () => {
		const bank = banksOf(xs, zs);
		let worst = 0;
		for (let r = 1; r < rows.length - 1; r++) {
			const p = rows[r];
			const [x, , z] = normal(r, 2);
			const roll = Math.asin(x * Math.cos(p.heading) - z * Math.sin(p.heading));
			worst = Math.max(worst, Math.abs(deg(roll - bank[r])));
		}
		expect(worst).toBeLessThan(0.1);
	});

	it('lights its shoulders by their own slope', () => {
		// 0.38 m down over 1.6 m: 13° off the asphalt's up.
		for (const r of [100, 500, 1000])
			for (const [outer, edge] of [
				[0, 1],
				[4, 3],
			])
				expect(angle(normal(r, outer), normal(r, edge))).toBeGreaterThan(10);
	});
});

describe("the winding road's bank", () => {
	const bank = Array.from(banksOf(xs, zs), deg);
	const middles = bendMiddles();
	/** The bank over the middle third of the bend of radius r, degrees, as magnitudes. */
	const across = (bend: number[], k: number) => {
		const r = WINDING_RADII[k];
		const arc = ((r < 20 ? 180 : 70) * Math.PI * r) / 180;
		const from = Math.round((middles[k] - arc / 6) / 2);
		const to = Math.round((middles[k] + arc / 6) / 2);
		return bend.slice(from, to + 1).map(Math.abs);
	};

	it('banks a hairpin and a tight corner fully', () => {
		for (const k of [0, 1])
			expect(Math.min(...across(bank, k))).toBeGreaterThan(3.5);
	});

	it('holds through a gentle bend instead of swinging with the line', () => {
		// The 250 m bend: its own bank is 1.5°.
		const k = WINDING_RADII.indexOf(250);
		const own = deg(bankOf(1 / 250));
		const steady = across(bank, k);
		const swing = (b: number[]) => Math.max(...b) - Math.min(...b);
		expect(Math.max(...steady.map((b) => Math.abs(b - own)))).toBeLessThan(0.8);
		// Read over 6 m, as before #4556, it swung over half as far again.
		const local = across(
			Array.from(bendsOf(xs, zs), (c) => deg(bankOf(c))),
			k,
		);
		expect(swing(steady)).toBeLessThan(0.7 * swing(local));
	});
});
