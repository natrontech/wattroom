// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { toRoute, type Route } from '$lib/road/route';
import { RIDE } from './look.test-helper';
import { pageGrids } from './chunks/grids';
import { compose, type Composed } from './compose';
import type { Family } from './family';
import { yOf } from './geometry';
import { makeRig } from './rig';
import type { SimRider } from './sim';
import { syntheticPoints } from './synthetic';
import { generate, type World } from './world';

/**
 * The world's scene budget, a merge gate (#3083, ADR-0066, docs/SPEC.md
 * "The world"): the scene the ride draws, walked as the renderer would draw
 * it from the chase camera — frustum culled, instanced and batched meshes
 * counted as the GPU sees them, with WEBGL_multi_draw on and off.
 *
 * Today's world is over two lines, each named with the issue that brings
 * it under; an entry that stops being over fails as stale, so the list can only
 * shrink. The low tier (30 draws, 150k; dressing 12 and 70k) gets its row
 * when a scene can be built low (#3080). Corridor decode (20 ms) waits for a
 * corridor to decode (#3128).
 */

const HIGH = {
	draws: 60,
	triangles: 400_000,
	'figures.triangles': 110_000,
	'dressing.draws': 24,
	'dressing.triangles': 180_000,
	/** Matrix buffers sent to the GPU in a frame: bone textures, instance and batch matrices (#3083). */
	uploads: 20,
};
type Line = keyof typeof HIGH;

const OVER: Partial<Record<Line, string>> = {
	draws:
		"#3642 batches the set pieces: every kit kind and every face of a sign's board is its own draw today",
	'dressing.draws':
		"#3642 batches the set pieces: every kit kind and every face of a sign's board is its own draw; the props are three",
};

/** Dressing drawn as plain meshes, and who batches it. */
const UNBATCHED: Record<string, string> = {
	sign: '#3642 batches the sign boards',
	arch: '#3642 batches the arch with the boards',
};

type Count = { draws: number; triangles: number };

function familyOf(o: THREE.Object3D): Family | null {
	for (let p: THREE.Object3D | null = o; p; p = p.parent)
		if (p.userData.family) return p.userData.family as Family;
	return null;
}

const drawable = (o: THREE.Object3D) =>
	(o as THREE.Mesh).isMesh ||
	(o as THREE.Points).isPoints ||
	(o as THREE.Line).isLine;

/** What one object costs a frame. */
function cost(
	o: THREE.Object3D,
	frustum: THREE.Frustum,
	multiDraw: boolean,
): Count {
	const mesh = o as THREE.Mesh;
	const g = mesh.geometry;
	const batched = o as THREE.BatchedMesh;
	if (batched.isBatchedMesh) {
		const sphere = new THREE.Sphere();
		const m = new THREE.Matrix4();
		let visible = 0;
		let triangles = 0;
		for (let i = 0; i < batched.maxInstanceCount; i++) {
			let geo: number;
			try {
				if (!batched.getVisibleAt(i)) continue;
				geo = batched.getGeometryIdAt(i);
			} catch {
				continue; // no instance at this id
			}
			if (
				batched.perObjectFrustumCulled &&
				batched.getBoundingSphereAt(geo, sphere)
			) {
				batched.getMatrixAt(i, m);
				sphere.applyMatrix4(m).applyMatrix4(batched.matrixWorld);
				if (!frustum.intersectsSphere(sphere)) continue;
			}
			visible++;
			triangles += (batched.getGeometryRangeAt(geo)?.count ?? 0) / 3;
		}
		return { draws: multiDraw ? Math.min(1, visible) : visible, triangles };
	}
	const instances = (o as THREE.InstancedMesh).isInstancedMesh
		? (o as THREE.InstancedMesh).count
		: 1;
	if (instances === 0) return { draws: 0, triangles: 0 };
	const each = mesh.isMesh
		? (g.index ? g.index.count : g.attributes.position.count) / 3
		: 0;
	const draws = Array.isArray(mesh.material) ? Math.max(1, g.groups.length) : 1;
	return { draws, triangles: each * instances };
}

type Frame = {
	multiDraw: boolean;
	/** Props drawn: batched instances in view. */
	props: number;
	lines: Record<Line, number>;
	drawn: Set<Family>;
	untagged: string[];
	unbatched: string[];
};

/** What the renderer would draw from `camera`: every budget line, and what it could not place. */
function measure(
	scene: THREE.Scene,
	camera: THREE.Camera,
	multiDraw: boolean,
): Frame {
	scene.updateMatrixWorld(true);
	camera.updateMatrixWorld();
	const frustum = new THREE.Frustum().setFromProjectionMatrix(
		new THREE.Matrix4().multiplyMatrices(
			camera.projectionMatrix,
			camera.matrixWorldInverse,
		),
	);
	const total: Count = { draws: 0, triangles: 0 };
	const per = new Map<Family, Count>();
	const untagged: string[] = [];
	const unbatched: string[] = [];
	let props = 0;
	scene.traverseVisible((o) => {
		if (!drawable(o) || (o.frustumCulled && !frustum.intersectsObject(o)))
			return;
		const family = familyOf(o);
		if (!family) {
			untagged.push(`${o.type} ${o.name}`.trim());
			return;
		}
		const c = cost(o, frustum, multiDraw);
		if ((o as THREE.BatchedMesh).isBatchedMesh && !multiDraw) props += c.draws;
		if (c.draws === 0) return;
		const f = per.get(family) ?? { draws: 0, triangles: 0 };
		f.draws += c.draws;
		f.triangles += c.triangles;
		per.set(family, f);
		total.draws += c.draws;
		total.triangles += c.triangles;
		if (
			family === 'dressing' &&
			!(o as THREE.InstancedMesh).isInstancedMesh &&
			!(o as THREE.BatchedMesh).isBatchedMesh
		)
			unbatched.push(kindOf(o));
	});
	const of = (f: Family) => per.get(f) ?? { draws: 0, triangles: 0 };
	return {
		lines: {
			draws: total.draws,
			triangles: total.triangles,
			'figures.triangles': of('figures').triangles,
			'dressing.draws': of('dressing').draws,
			'dressing.triangles': of('dressing').triangles,
			uploads: 0,
		},
		multiDraw,
		props,
		drawn: new Set(per.keys()),
		untagged,
		unbatched,
	};
}

/**
 * O13 (#3221, ADR-0072): what makes its own light or adds light to what is
 * behind it. Only the rider's own trail may.
 */
function glowing(root: THREE.Object3D): string[] {
	const out: string[] = [];
	root.traverse((o) => {
		const mat = (o as THREE.Mesh).material;
		if (!mat) return;
		for (const m of [mat].flat()) {
			const e = (m as THREE.MeshLambertMaterial).emissive;
			const lit =
				!!e &&
				e.r + e.g + e.b > 0 &&
				(m as THREE.MeshLambertMaterial).emissiveIntensity > 0;
			if (
				(lit || m.blending === THREE.AdditiveBlending) &&
				kindOf(o) !== 'trail'
			)
				out.push(`${kindOf(o)} ${m.type}`);
		}
	});
	return out;
}

function kindOf(o: THREE.Object3D): string {
	for (let p: THREE.Object3D | null = o; p; p = p.parent)
		if (p.userData.kind) return p.userData.kind as string;
	return o.type;
}

/**
 * Matrix buffers one frame sends: a bone texture per skinned mesh drawn,
 * and every instance or batch whose matrices moved.
 */
function uploads(w: Composed, seconds: number): number {
	const moved = new Set<THREE.Object3D>();
	const setAt = THREE.BatchedMesh.prototype.setMatrixAt;
	THREE.BatchedMesh.prototype.setMatrixAt = function (
		this: THREE.BatchedMesh,
		id,
		m,
	) {
		moved.add(this);
		return setAt.call(this, id, m);
	};
	const before = new Map<THREE.InstancedMesh, number>();
	w.scene.traverse((o) => {
		const im = o as THREE.InstancedMesh;
		if (im.isInstancedMesh) before.set(im, im.instanceMatrix.version);
	});
	try {
		w.advanceBy(seconds);
	} finally {
		THREE.BatchedMesh.prototype.setMatrixAt = setAt;
	}
	let n = moved.size;
	w.scene.traverseVisible((o) => {
		if ((o as THREE.SkinnedMesh).isSkinnedMesh) n++;
		const im = o as THREE.InstancedMesh;
		if (im.isInstancedMesh && im.instanceMatrix.version !== before.get(im)) n++;
	});
	return n;
}

describe('the counter', () => {
	const camera = new THREE.PerspectiveCamera(60, 1, 1, 1000);
	camera.position.set(0, 0, 10);
	const frustum = () => {
		camera.updateMatrixWorld();
		return new THREE.Frustum().setFromProjectionMatrix(
			new THREE.Matrix4().multiplyMatrices(
				camera.projectionMatrix,
				camera.matrixWorldInverse,
			),
		);
	};

	it('counts a batch as one draw with multi-draw and one per instance without, culling each', () => {
		const box = new THREE.BoxGeometry(1, 1, 1); // 12 triangles
		const b = new THREE.BatchedMesh(4, 100, 100, new THREE.MeshBasicMaterial());
		const geo = b.addGeometry(box);
		const at = (x: number, z: number) =>
			b.setMatrixAt(
				b.addInstance(geo),
				new THREE.Matrix4().makeTranslation(x, 0, z),
			);
		at(0, 0);
		at(1, 0);
		at(0, 50); // behind the camera
		b.perObjectFrustumCulled = true;
		b.updateMatrixWorld();
		expect(cost(b, frustum(), true)).toEqual({ draws: 1, triangles: 24 });
		expect(cost(b, frustum(), false)).toEqual({ draws: 2, triangles: 24 });
		b.setVisibleAt(1, false);
		expect(cost(b, frustum(), false)).toEqual({ draws: 1, triangles: 12 });
	});

	it('counts an instanced mesh once, its triangles per instance, and nothing when empty', () => {
		const im = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial(),
			5,
		);
		expect(cost(im, frustum(), true)).toEqual({ draws: 1, triangles: 60 });
		im.count = 0;
		expect(cost(im, frustum(), true)).toEqual({ draws: 0, triangles: 0 });
	});

	it('counts a draw per material group', () => {
		const box = new THREE.BoxGeometry(1, 1, 1);
		const mats = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial());
		expect(cost(new THREE.Mesh(box, mats), frustum(), true).draws).toBe(6);
	});
});

describe('the ride’s scene budget, high tier (#3083)', () => {
	let route: Route;
	let world: World;
	let w: Composed;
	const frames: Frame[] = [];
	const style = RIDE;

	beforeAll(() => {
		route = toRoute(syntheticPoints());
		world = generate(route);
		// Every chunk within reach, built at once: the ground as a ride holds it once the worker is done.
		w = compose(
			{ route, world, style, ftp: 250, grids: pageGrids(world) },
			null,
		);
		w.camera.aspect = 16 / 9;
		w.camera.updateProjectionMatrix();
		// At the start, the riders in view, a few frames in.
		for (let k = 0; k < 4; k++) w.advanceBy(1 / 30);
		for (const multiDraw of [true, false])
			frames.push(measure(w.scene, w.camera, multiDraw));
		frames[0].lines.uploads = uploads(w, 1 / 30);
		// And the chase camera every 2 km of the ride, as the rig would hold it.
		const rig = makeRig(route, world);
		const you = new THREE.Vector3();
		for (let d = 2000; d < route.length; d += 2000) {
			const rider = { d, v: 8 } as SimRider;
			rig.reset();
			for (let k = 0; k < 3; k++) {
				const p = at(route, d);
				rig.update(
					w.camera,
					'chase',
					rider,
					you.set(p.x, yOf(route, p.ele) + 1, p.z),
					1 / 30,
				);
			}
			w.look();
			for (const multiDraw of [true, false])
				frames.push(measure(w.scene, w.camera, multiDraw));
		}
	}, 60_000);

	// Without WEBGL_multi_draw a BatchedMesh draws once per instance: that is
	// the Firefox spectator's path (#3076's decision keeps it), so the draw
	// lines hold with it on. Triangles are the GPU's work either way.
	const DRAWS = new Set<Line>(['draws', 'dressing.draws']);
	const worst = (line: Line) =>
		Math.max(
			...frames
				.filter((f) => f.multiDraw || !DRAWS.has(line))
				.map((f) => f.lines[line]),
		);

	it('declares a family for everything it draws', () => {
		expect(frames.flatMap((f) => f.untagged)).toEqual([]);
	});

	it('batches its dressing: every prop is instanced or batched', () => {
		const loose = [...new Set(frames.flatMap((f) => f.unbatched))].filter(
			(k) => !UNBATCHED[k],
		);
		expect(
			loose,
			'dressing drawn one mesh at a time: instance or batch it',
		).toEqual([]);
	});

	it.each(Object.keys(HIGH) as Line[])(
		'holds %s to the high tier, or names who brings it under',
		(line) => {
			const at = worst(line);
			if (OVER[line])
				expect(
					at,
					`${line} is under its ${HIGH[line]} now: take it out of OVER`,
				).toBeGreaterThan(HIGH[line]);
			else
				expect(at, `${line} over the high tier`).toBeLessThanOrEqual(
					HIGH[line],
				);
		},
	);

	it('draws the ground and the road in every frame it measures', () => {
		for (const f of frames)
			expect([...f.drawn]).toEqual(expect.arrayContaining(['terrain', 'road']));
	});

	it('draws the props around the camera in every frame, as its rings stand there', () => {
		for (const f of frames.filter((g) => !g.multiDraw))
			expect(f.props).toBeGreaterThan(0);
	});

	it('lights nothing but the rider’s own trail (O13, #3221)', () => {
		expect(glowing(w.scene)).toEqual([]);
		const lamp = new THREE.Mesh(
			new THREE.BoxGeometry(),
			new THREE.MeshLambertMaterial({ emissive: 'white' }),
		);
		const add = new THREE.Mesh(
			new THREE.BoxGeometry(),
			new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending }),
		);
		const probe = new THREE.Group().add(lamp, add);
		expect(glowing(probe)).toHaveLength(2);
	});

	it('draws the riders it counts', () => {
		expect(worst('figures.triangles')).toBeGreaterThan(0);
		expect(frames[0].lines.uploads).toBeGreaterThan(0);
	});

	it('keeps its unbatched exceptions real', () => {
		const kinds = new Set<string>();
		w.scene.traverse((o) => {
			if (
				familyOf(o) === 'dressing' &&
				drawable(o) &&
				!(o as THREE.InstancedMesh).isInstancedMesh &&
				!(o as THREE.BatchedMesh).isBatchedMesh
			)
				kinds.add(kindOf(o));
		});
		expect([...kinds].sort()).toEqual(Object.keys(UNBATCHED).sort());
	});
});

describe('a bunch on the road (#3098)', () => {
	it('keeps twelve riders and the team car inside the figures’ share, tagged and unlit', () => {
		const route = toRoute(syntheticPoints());
		const world = generate(route);
		const style = RIDE;
		// docs/SPEC.md "The world": the figures' share holds 12 near figures.
		const order = Array.from({ length: 12 }, (_, i) => `r${i}`);
		const w = compose(
			{
				route,
				world,
				style,
				ftp: 250,
				youId: 'r0',
				metre: () => ({ m: 500, mps: 8 }),
				bunch: () => ({
					m: 500,
					mps: 8,
					elapsed: 30,
					order: ['coach', ...order],
					offsets: {},
					resting: ['coach'],
					coach: 'coach',
					present: new Map(order.map((id) => [id, { watts: 200, ftp: 250 }])),
					game: false,
				}),
				grids: pageGrids(world),
			},
			null,
		);
		w.camera.aspect = 16 / 9;
		w.camera.updateProjectionMatrix();
		for (let k = 0; k < 30; k++) w.advanceBy(1 / 30);
		const frame = measure(w.scene, w.camera, true);
		expect(frame.untagged).toEqual([]);
		expect(glowing(w.scene)).toEqual([]);
		const kinds = new Set<string>();
		w.scene.traverseVisible((o) => {
			if (familyOf(o) === 'figures') kinds.add(kindOf(o));
		});
		expect(kinds.has('car'), 'the coach with no trainer drives the car').toBe(
			true,
		);
		expect(frame.lines['figures.triangles']).toBeGreaterThan(0);
		expect(frame.lines['figures.triangles']).toBeLessThanOrEqual(
			HIGH['figures.triangles'],
		);
		w.dispose();
	}, 60_000);
});
