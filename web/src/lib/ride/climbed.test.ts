import { describe, expect, it } from 'vitest';
import type { Road } from '$lib/road/road';
import { climbedM } from './climbed';

// Ten metres a sample: up 10, down 4, up 6, flat, down 10.
const road: Road = {
	length: 50,
	heights: [100, 110, 106, 112, 112, 102],
	turns: [0, 0, 0, 0, 0],
};

describe('climbedM', () => {
	it('sums the rises ridden, never the falls', () => {
		expect(climbedM(road, 0, 50)).toBe(16);
		expect(climbedM(road, 0, 10)).toBe(10);
		expect(climbedM(road, 10, 20)).toBe(0);
	});

	it('ridden back, the descents are the climbs', () => {
		expect(climbedM(road, 50, 0)).toBe(14);
		expect(climbedM(road, 50, 40)).toBe(10);
	});

	it('reads a part of a sample as its part, so seconds add up to the road', () => {
		expect(climbedM(road, 0, 5)).toBe(5);
		expect(climbedM(road, 5, 15)).toBeCloseTo(5);
		let sum = 0;
		for (let m = 2.5; m <= 50; m += 2.5) sum += climbedM(road, m - 2.5, m);
		expect(sum).toBeCloseTo(16);
	});

	it('clamps to the road and climbs nothing standing still', () => {
		expect(climbedM(road, 20, 20)).toBe(0);
		expect(climbedM(road, -5, 500)).toBe(16);
	});
});
