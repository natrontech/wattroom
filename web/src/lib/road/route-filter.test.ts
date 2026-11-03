import { describe, expect, it } from 'vitest';
import type { Road } from './road';
import { fitsBounds, secondsAtPace, type RouteBounds } from './route-filter';

const none: RouteBounds = { km: null, up: null, hours: null };
const route = { lengthM: 50_000, gainM: 500 };

describe('fitsBounds', () => {
	it('keeps every route with no chip lit', () => {
		expect(fitsBounds(route, 7200, none)).toBe(true);
	});

	it('reads each chip as an at-most, the bound itself included', () => {
		expect(fitsBounds(route, null, { ...none, km: 50 })).toBe(true);
		expect(fitsBounds(route, null, { ...none, km: 20 })).toBe(false);
		expect(fitsBounds(route, null, { ...none, up: 500 })).toBe(true);
		expect(fitsBounds(route, null, { ...none, up: 250 })).toBe(false);
		expect(fitsBounds(route, 3600, { ...none, hours: 1 })).toBe(true);
		expect(fitsBounds(route, 3601, { ...none, hours: 1 })).toBe(false);
	});

	it('needs every lit group to fit', () => {
		expect(fitsBounds(route, 3600, { km: 100, up: 250, hours: 3 })).toBe(false);
	});

	it('keeps a route whose time is not known yet', () => {
		expect(fitsBounds(route, null, { ...none, hours: 1 })).toBe(true);
	});
});

describe('secondsAtPace', () => {
	// A flat 10 km road sampled every 20 m.
	const flat: Road = {
		length: 10_000,
		heights: Array(501).fill(0),
		turns: Array(500).fill(0),
	};
	const road = {
		id: 'r1',
		genName: 'Road · 10.0 km · 0 m',
		road: flat,
		climbs: [],
	};

	it('rides the road quicker at a higher FTP', () => {
		const slow = secondsAtPace(road, 200, 75);
		const quick = secondsAtPace(road, 300, 75);
		expect(slow).toBeGreaterThan(0);
		expect(quick).toBeLessThan(slow);
	});
});
