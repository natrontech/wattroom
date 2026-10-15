import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Road } from '$lib/road/road';
import ComputerMap from './ComputerMap.svelte';
import { mapView, shapeOf } from './map-view';

/** A road that climbs 8 % for 1.5 km and bends right by 90° at the top. */
const heights = [
	...Array(26).fill(500),
	...Array.from({ length: 75 }, (_, i) => 500 + (i + 1) * 1.6),
	...Array(25).fill(620),
];
const turns = heights.slice(1).map((_, i) => (i === 40 ? 90 : 0));
const road: Road = { length: (heights.length - 1) * 20, heights, turns };
const view = (m: number, reverse = false) => ({ road, m, mps: 8, reverse });

describe('the MAP page as the crew tier draws it (#3645, ADR-0063)', () => {
	it('is nothing without a road', () => {
		expect(mapView(null)).toBeNull();
	});

	it('walks the shape from the turns alone: relative metres, never a coordinate', () => {
		const { x, z } = shapeOf(road);
		expect(x).toHaveLength(heights.length);
		expect([x[0], z[0]]).toEqual([0, 0]);
		// 800 m straight on, then 90° round: the far end is off the first axis.
		expect(Math.abs(z[z.length - 1])).toBeGreaterThan(500);
		expect(shapeOf(road)).toBe(shapeOf(road));
	});

	it('carries the classed climbs and the dot as the lap rides it', () => {
		expect(mapView(view(700))!.climbs).toHaveLength(1);
		expect(mapView(view(700, true))!.m).toBe(road.length - 700);
	});

	it('draws the road and the dot, with no word of a place', () => {
		const { body } = render(ComputerMap, {
			props: { view: mapView(view(700))! },
		});
		// Sized by the browser: the server render holds the panel, not a shape.
		expect(body).toContain('data-testid="computer-map"');
		expect(body).not.toMatch(/-?\d+\.\d{4,}/);
	});
});
