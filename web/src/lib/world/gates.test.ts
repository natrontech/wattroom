// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import type { PaintedGate } from '$lib/road/gates';
import { BANNER_M, CHEVRONS_M, makeGates } from './gates';
import { ROAD_LIFT, roadMaterial, yOf } from './geometry';
import { RIDE } from './look.test-helper';
import { routeOfRoad } from './road-route';
import { ROAD_W } from './terrain/road-profile';

const route = routeOfRoad(legsRoad([1000, 0], [3000, 6], [1000, 0]));
const tempo: PaintedGate = {
	index: 1,
	m: 600,
	words: 'TEMPO 220 W',
	sprint: false,
};
const sprint: PaintedGate = {
	index: 2,
	m: 2400,
	words: 'SPRINT',
	sprint: true,
};

type Layer = ReturnType<typeof makeGates>;
const kind = (layer: Layer, k: string) =>
	layer.group.children.filter((o) => o.userData.kind === k);
const words = (layer: Layer) =>
	kind(layer, 'gate').filter((o) => o.visible) as THREE.Mesh<
		THREE.BufferGeometry,
		THREE.MeshLambertMaterial
	>[];
const chevrons = (layer: Layer) =>
	kind(layer, 'chevrons')[0] as THREE.InstancedMesh<
		THREE.BufferGeometry,
		THREE.MeshLambertMaterial
	>;

describe('the next blocks painted on the road (#3101)', () => {
	it('paints a block’s words flat on the asphalt from where it starts, reading up the road', () => {
		const layer = makeGates(route, RIDE);
		layer.update([tempo, sprint], 0);
		const painted = words(layer);
		expect(painted.map((m) => m.userData.words)).toEqual([
			'TEMPO 220 W',
			'SPRINT',
		]);
		for (const [mesh, g] of painted.map(
			(m, i) => [m, [tempo, sprint][i]] as const,
		)) {
			const p = at(route, g.m);
			expect(mesh.position.x).toBeCloseTo(p.x, 3);
			expect(mesh.position.z).toBeCloseTo(p.z, 3);
			const asphalt = yOf(route, p.ele) + ROAD_LIFT;
			expect(mesh.position.y - asphalt).toBeGreaterThan(0);
			expect(mesh.position.y - asphalt).toBeLessThan(0.1);
			// The paint runs up the road from the gate's metre, never back down it.
			mesh.geometry.computeBoundingBox();
			const box = mesh.geometry.boundingBox!;
			expect(box.max.y - box.min.y).toBeCloseTo(0, 6);
			expect(box.max.z).toBeCloseTo(0, 6);
			expect(box.max.x - box.min.x).toBeLessThanOrEqual(ROAD_W);
			const up = new THREE.Vector3(0, 0, -1).applyEuler(mesh.rotation);
			expect(up.x).toBeCloseTo(Math.sin(p.heading), 6);
			expect(up.z).toBeCloseTo(Math.cos(p.heading), 6);
			// Road paint (ADR-0072), and nothing on it glows (ADR-0005).
			expect(mesh.material).toBeInstanceOf(roadMaterial(RIDE.road).constructor);
			expect(mesh.material.emissive.getHex()).toBe(0);
			expect(mesh.userData.family).toBe('road');
		}
	});

	it('leads to each gate with chevrons over its last 100 m, in the road line', () => {
		const layer = makeGates(route, RIDE);
		layer.update([tempo, sprint], 0);
		const ch = chevrons(layer);
		expect(ch.count).toBe(10);
		expect(ch.material.color.getHexString()).toBe(
			new THREE.Color(RIDE.road.line).getHexString(),
		);
		expect(ch.material.emissive.getHex()).toBe(0);
		const m = new THREE.Matrix4();
		const v = new THREE.Vector3();
		for (let i = 0; i < ch.count; i++) {
			ch.getMatrixAt(i, m);
			v.setFromMatrixPosition(m);
			const gate = i < 5 ? tempo : sprint;
			// On the road somewhere in the 100 m before its gate.
			const near = Array.from({ length: CHEVRONS_M + 1 }, (_, k) =>
				at(route, gate.m - k),
			).some((p) => Math.hypot(p.x - v.x, p.z - v.z) < 0.5);
			expect(near, `chevron ${i}`).toBe(true);
		}
	});

	it('stands a sprint’s banner across the road from 1 km out, and lets it go once ridden past', () => {
		const layer = makeGates(route, RIDE);
		const gates = [tempo, sprint];
		layer.update(gates, sprint.m - BANNER_M - 10);
		expect(kind(layer, 'arch')).toHaveLength(0);
		layer.update(gates, sprint.m - BANNER_M + 10);
		const [arch] = kind(layer, 'arch');
		expect(arch.userData.family).toBe('dressing');
		const p = at(route, sprint.m);
		expect(arch.position.x).toBeCloseTo(p.x, 3);
		expect(arch.position.z).toBeCloseTo(p.z, 3);
		// The plan ridden again moves it, the same banner.
		const moved = [tempo, { ...sprint, m: sprint.m + 6 }];
		layer.update(moved, sprint.m - 500);
		expect(kind(layer, 'arch')).toEqual([arch]);
		expect(arch.position.x).toBeCloseTo(at(route, sprint.m + 6).x, 3);
		layer.update(moved, sprint.m + 20);
		expect(kind(layer, 'arch')).toHaveLength(0);
	});

	it('paints only the gates it is given, and nothing once none are left', () => {
		const layer = makeGates(route, RIDE);
		layer.update([tempo, sprint], 0);
		const first = words(layer)[0].material.map;
		layer.update([sprint], 700);
		expect(words(layer).map((m) => m.userData.words)).toEqual(['SPRINT']);
		expect(chevrons(layer).count).toBe(5);
		expect(words(layer)[0].material.map).not.toBe(first);
		layer.update([], 2500);
		expect(words(layer)).toHaveLength(0);
		expect(chevrons(layer).count).toBe(0);
	});
});
