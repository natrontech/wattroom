// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Chalk } from '$lib/channel/bunch-view';
import { at } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import { makeChalk } from './chalk';
import { ROAD_LIFT, yOf } from './geometry';
import { routeOfRoad } from './road-route';

const route = routeOfRoad(legsRoad([1000, 0], [2000, 6], [1000, 0]));
const stamps = (layer: ReturnType<typeof makeChalk>) =>
	layer.group.children as THREE.Mesh<
		THREE.BufferGeometry,
		THREE.MeshBasicMaterial
	>[];

describe('the roadside’s chalk (#3029)', () => {
	const heart: Chalk = { key: 'kim@1500', stamp: 'heart', letter: '', u: 1500 };
	const initial: Chalk = {
		key: 'kim@2500',
		stamp: 'initial',
		letter: 'A',
		u: 2500,
	};

	it('lays each stamp flat on the road at its metre, unlit, reading up the road', () => {
		const layer = makeChalk(route);
		layer.update([heart, initial]);
		expect(stamps(layer)).toHaveLength(2);
		for (const [mesh, c] of stamps(layer).map(
			(m, i) => [m, [heart, initial][i]] as const,
		)) {
			const p = at(route, c.u);
			expect(mesh.position.x).toBeCloseTo(p.x, 3);
			expect(mesh.position.z).toBeCloseTo(p.z, 3);
			// On the asphalt, a hair above it: the road rides ROAD_LIFT over the centre line.
			const asphalt = yOf(route, p.ele) + ROAD_LIFT;
			expect(mesh.position.y - asphalt).toBeGreaterThan(0);
			expect(mesh.position.y - asphalt).toBeLessThan(0.1);
			expect(mesh.rotation.y).toBeCloseTo(p.heading, 6);
			mesh.geometry.computeBoundingBox();
			const box = mesh.geometry.boundingBox!;
			expect(box.max.y - box.min.y).toBeCloseTo(0, 6);
			// Scenery: no light shades it and nothing on it glows (ADR-0005).
			expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
			expect(mesh.userData.stamp).toBe(c.stamp);
		}
	});

	it('keeps a stamp while it lies on the road, and lets it go once ridden over', () => {
		const layer = makeChalk(route);
		layer.update([heart, initial]);
		const [first, second] = stamps(layer);
		layer.update([initial]);
		expect(stamps(layer)).toEqual([second]);
		expect(stamps(layer)).not.toContain(first);
		layer.update([initial, { ...heart, key: 'cy@1700', u: 1700 }]);
		expect(stamps(layer)[0]).toBe(second);
		layer.update([]);
		expect(stamps(layer)).toHaveLength(0);
	});
});
