import { describe, expect, it } from 'vitest';
import type { Route } from '$lib/road/route';
import { bearings } from './backdrop';

/** A flat route that rides each heading (degrees, compass: 0 north, 90 east) for that many steps. */
function ridden(legs: [heading: number, steps: number][]): Route {
	const x = [0];
	const z = [0];
	for (const [heading, steps] of legs) {
		const rad = (heading * Math.PI) / 180;
		for (let i = 0; i < steps; i++) {
			x.push(x[x.length - 1] + 10 * Math.sin(rad));
			z.push(z[z.length - 1] + 10 * Math.cos(rad));
		}
	}
	return {
		x: Float64Array.from(x),
		z: Float64Array.from(z),
		grade: new Float64Array(x.length),
		step: 10,
	} as unknown as Route;
}

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

describe('the horizon bearings', () => {
	// A bin votes for every heading within 34° of it, whichever side of north
	// the heading's atan2 puts it on. Bins are 10° wide and the hero is the
	// first bin with the most riding time, so a lone heading names the lowest
	// bin in reach, and a second heading shows which bins the first one reached.
	it.each([
		{ name: 'north', legs: [[0, 3]], hero: 0, share: 1 },
		{ name: 'east', legs: [[90, 3]], hero: 60, share: 1 },
		{ name: 'south', legs: [[180, 3]], hero: 150, share: 1 },
		{
			name: 'south, reached from the west side of atan2',
			legs: [[-180, 3]],
			hero: 150,
			share: 1,
		},
		{ name: 'west', legs: [[-90, 3]], hero: 240, share: 1 },
		{
			name: 'west does not reach the bins 40 to 80° from it',
			legs: [
				[-90, 3],
				[-10, 2],
			],
			hero: 240,
			share: 0.6,
		},
		{
			name: 'north-west does not reach the bins 40 to 80° from it',
			legs: [
				[-45, 3],
				[-120, 2],
			],
			hero: 290,
			share: 0.6,
		},
		{
			name: 'west and the same west by the other sign agree',
			legs: [
				[-90, 2],
				[270, 2],
			],
			hero: 240,
			share: 1,
		},
	] as {
		name: string;
		legs: [number, number][];
		hero: number;
		share: number;
	}[])('$name', ({ legs, hero, share }) => {
		const b = bearings(ridden(legs));
		expect(deg(b.hero)).toBe(hero);
		expect(b.share).toBeCloseTo(share, 9);
	});
});
