import { describe, expect, it } from 'vitest';
import { hairpinClimb } from '$lib/road/fixtures';
import { toRoute } from '$lib/road/route';
import { GOLDEN_HASH, goldenKeying, goldenRoad } from './golden.test-helper';
import { placementHash, type Keying } from './region';
import { reverseRoad, STROKE_STEP_M, strokeMetre, strokeOf } from './stroke';
import type { Salt } from './keyed';

const SALT: Salt = [5, 6, 7, 8];

describe('a served road as its own stroke', () => {
	const route = toRoute(hairpinClimb());

	it('is the same stroke ridden back the way you came (#3205)', () => {
		const out = strokeOf({ h: 'h1', road: route.road });
		const back = strokeOf({ h: 'h1', road: reverseRoad(route.road) });
		expect(back.key).toBe(out.key);
		expect(back.points).toEqual(out.points);
		// One spot on the road is one metre on the stroke, whichever way it is ridden.
		for (const d of [0, 123.4, route.road.length / 2, route.road.length])
			expect(strokeMetre(back, route.road.length - d)).toBeCloseTo(
				strokeMetre(out, d),
				9,
			);
	});

	it('is keyed by the served road’s hash, which names its snapshot', () => {
		expect(strokeOf({ h: 'abc', road: route.road }).key).toBe('abc');
	});

	it('is a polyline every 2 m, ending on the road’s end', () => {
		const { points, length } = strokeOf({ h: 'h', road: route.road });
		const n = points.length / 2;
		expect(n).toBe(Math.floor(length / STROKE_STEP_M) + 2);
		for (let q = 1; q < n - 1; q++) {
			const d = Math.sqrt(
				(points[2 * q] - points[2 * q - 2]) ** 2 +
					(points[2 * q + 1] - points[2 * q - 1]) ** 2,
			);
			expect(d).toBeGreaterThan(STROKE_STEP_M * 0.99);
			expect(d).toBeLessThanOrEqual(STROKE_STEP_M + 1e-9);
		}
	});

	it('builds the owner’s world and a crewmate’s alike, the owner’s coordinates notwithstanding', () => {
		const keying = (served: {
			h: string;
			road: typeof route.road;
		}): Keying => ({
			stroke: strokeOf(served),
			salt: SALT,
			regions: [],
		});
		// What each is served (ADR-0063): the owner also holds the shape.
		const owner = { h: 'h', road: route.road, shape: route.shape };
		const crew = { h: 'h', road: route.road };
		const span = route.road.length;
		expect(placementHash(keying(owner), 0, span, 40)).toBe(
			placementHash(keying(crew), 0, span, 40),
		);
	});
});

describe('the golden world', () => {
	it('hashes to the value every engine and worker must reach', () => {
		expect(placementHash(goldenKeying(), 0, goldenRoad().length, 40)).toBe(
			GOLDEN_HASH,
		);
	});
});
