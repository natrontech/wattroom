// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Chalk } from '$lib/channel/bunch-view';
import { at, leftOf } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import { LANE } from './bunch';
import { lanesFor } from './lanes';
import { BESIDE, makeChalk } from './chalk';
import { ROAD_LIFT, roadMaterial, yOf } from './geometry';
import { RIDE } from './look.test-helper';
import { routeOfRoad } from './road-route';
import { ROAD_W } from './terrain/road-profile';

const route = routeOfRoad(legsRoad([1000, 0], [2000, 6], [1000, 0]));
const stamps = (layer: ReturnType<typeof makeChalk>) =>
	layer.group.children as THREE.Mesh<
		THREE.BufferGeometry,
		THREE.MeshLambertMaterial
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
		const layer = makeChalk(route, RIDE);
		layer.update([heart, initial]);
		expect(stamps(layer)).toHaveLength(2);
		for (const [mesh, c] of stamps(layer).map(
			(m, i) => [m, [heart, initial][i]] as const,
		)) {
			const p = at(route, c.u);
			const { lx, lz } = leftOf(p.heading);
			expect(mesh.position.x).toBeCloseTo(p.x + lx * BESIDE, 3);
			expect(mesh.position.z).toBeCloseTo(p.z + lz * BESIDE, 3);
			// On the asphalt, a hair above it: the road rides ROAD_LIFT over the centre line.
			const asphalt = yOf(route, p.ele) + ROAD_LIFT;
			expect(mesh.position.y - asphalt).toBeGreaterThan(0);
			expect(mesh.position.y - asphalt).toBeLessThan(0.1);
			// Reading up the road: the texture's top (the plane's -z once laid
			// flat) points the way the riders go.
			const top = new THREE.Vector3(0, 0, -1).applyEuler(mesh.rotation);
			expect(top.x).toBeCloseTo(Math.sin(p.heading), 6);
			expect(top.z).toBeCloseTo(Math.cos(p.heading), 6);
			mesh.geometry.computeBoundingBox();
			const box = mesh.geometry.boundingBox!;
			expect(box.max.y - box.min.y).toBeCloseTo(0, 6);
			// Scenery, shaded as the road's paint is (ADR-0072), and nothing on it glows (ADR-0005).
			expect(mesh.material).toBeInstanceOf(roadMaterial(RIDE.road).constructor);
			expect(mesh.material.emissive.getHex()).toBe(0);
			expect(mesh.userData.stamp).toBe(c.stamp);
		}
	});

	it('lies beside the riders’ line, never under three abreast, and on the asphalt (v2-erg)', () => {
		const layer = makeChalk(route, RIDE);
		layer.update([heart]);
		const [mesh] = stamps(layer);
		mesh.geometry.computeBoundingBox();
		const half =
			(mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x) / 2;
		// Three abreast ride ±LANE; a rider's shoulders are about 0.3 m either side of their line.
		const widest = ((lanesFor(6) - 1) / 2) * LANE + 0.3;
		expect(BESIDE - half).toBeGreaterThan(widest);
		expect(BESIDE + half).toBeLessThanOrEqual(ROAD_W / 2);
	});

	it('keeps a stamp while it lies on the road, and lets it go once ridden over', () => {
		const layer = makeChalk(route, RIDE);
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
