import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toRoute, type Route } from '$lib/road/route';
import { backdrop, bearings } from './backdrop';
import { yOf } from './geometry';
import { syntheticPoints } from './synthetic';

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

describe('the skyline the peach band lies on (#3085)', () => {
	const route = toRoute(syntheticPoints());
	const radius = 6000;
	const { geometry, skyline } = backdrop(
		route,
		7,
		radius,
		{ ridge: '#333', rock: '#444', snow: '#eee', fog: '#666' },
		false,
	);
	const eye = new THREE.Vector3(1200, yOf(route, route.minEle) + 40, -800);
	skyline.from(eye);
	const data = skyline.texture.image.data as Uint8Array;
	const n = data.length;
	/** The band's top at a bearing (radians from +z clockwise), as the sky reads it: linear, wrapping. */
	const top = (a: number) => {
		const f = ((((a / (Math.PI * 2)) % 1) + 1) % 1) * n - 0.5;
		const i = Math.floor(f);
		const k = f - i;
		const v = (j: number) => data[(j + n) % n] / 255 / 4;
		return v(i) * (1 - k) + v(i + 1) * k;
	};

	it('stands over every far crest at its own bearing, so no range covers the band', () => {
		const pos = geometry.getAttribute('position');
		let checked = 0;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const z = pos.getZ(i);
			// The far two rings make the horizon; the near one stands before it.
			if (Math.hypot(x, z) < radius + 8000 - 1) continue;
			const dx = x - eye.x;
			const dz = z - eye.z;
			const up = pos.getY(i) - eye.y;
			const sine = up / Math.hypot(dx, dz, up);
			expect(top(Math.atan2(dx, dz))).toBeGreaterThanOrEqual(sine - 0.002);
			checked++;
		}
		expect(checked).toBeGreaterThan(1000);
	});

	it('stays low, as distant ranges do: under 9° all round', () => {
		for (let i = 0; i < n; i++)
			expect(data[i] / 255 / 4).toBeLessThan(Math.sin((9 * Math.PI) / 180));
	});
});
