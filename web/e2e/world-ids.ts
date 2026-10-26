// The world drawn as object IDs (#3222): every drawn object its own number
// and every instance of a batch its own, read back so an e2e can count what a
// frame shows of each. Each object's own material draws it, so the sightline
// dither, the skinning and the batch matrices discard and move exactly as on
// a ride; only the colour it writes is replaced. world-ids.spec.ts's, never
// the app's.
import * as THREE from 'three';
import type { Composed } from '../src/lib/world/compose';
import {
	appeared,
	flickers,
	hidden,
	OBJECT_BITS,
	type Cover,
	type Ids,
	type Shown,
} from './world-ids-measure';

/** The step a pop is measured over: one frame at the ride's 30 fps (docs/SPEC.md "The world"). */
const STEP_S = 1 / 30;
/** One instance's step in an ID. */
const INSTANCE = 0x10000;

const MAIN = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)/;

const VERTEX_ID = /* glsl */ `
flat varying float vWattroomInstance;
void main() {
	wattroomMain();
	#if defined(USE_BATCHING)
		vWattroomInstance = getIndirectIndex(gl_DrawID);
	#elif defined(USE_INSTANCING)
		vWattroomInstance = float(gl_InstanceID);
	#else
		vWattroomInstance = 0.0;
	#endif
}`;

const FRAGMENT_ID = /* glsl */ `
uniform vec2 uWattroomId;
flat varying float vWattroomInstance;
void main() {
	wattroomMain();
	float i = vWattroomInstance;
	gl_FragColor = vec4(uWattroomId, mod(i, 256.0) / 255.0, floor(i / 256.0) / 255.0);
}`;

/** The material drawing `src`'s object as object `n`: its own shader, run to the end, then the ID written over its colour. */
function idMaterial(src: THREE.Material, n: number): THREE.Material {
	const m = src.clone();
	// A shader's per-frame uniforms stay the live ones, not a copy frozen now.
	if ((src as THREE.ShaderMaterial).isShaderMaterial)
		(m as THREE.ShaderMaterial).uniforms = {
			...(src as THREE.ShaderMaterial).uniforms,
		};
	m.blending = THREE.NoBlending;
	const id = { value: new THREE.Vector2((n & 255) / 255, (n >> 8) / 255) };
	m.onBeforeCompile = (shader, renderer) => {
		src.onBeforeCompile(shader, renderer);
		shader.uniforms.uWattroomId = id;
		// The terrain's own shader draws its batch without the batch's chunks: the instance needs them.
		const batching = shader.vertexShader.includes(
			'#include <batching_pars_vertex>',
		)
			? ''
			: '#include <batching_pars_vertex>\n';
		shader.vertexShader =
			batching +
			shader.vertexShader.replace(MAIN, 'void wattroomMain()') +
			VERTEX_ID;
		shader.fragmentShader =
			shader.fragmentShader.replace(MAIN, 'void wattroomMain()') + FRAGMENT_ID;
	};
	m.customProgramCacheKey = () => `${src.customProgramCacheKey()}|id`;
	return m;
}

/** What a rider's fade changes on a material each frame (crew.ts), carried onto its clone. */
function follow(src: THREE.Material, id: THREE.Material) {
	id.opacity = src.opacity;
	id.visible = src.visible;
	if (id.alphaHash !== src.alphaHash || id.alphaTest !== src.alphaTest) {
		id.alphaHash = src.alphaHash;
		id.alphaTest = src.alphaTest;
		id.needsUpdate = true;
	}
}

type Drawn = THREE.Object3D & { material: THREE.Material | THREE.Material[] };

/** What names an object in a report: the nearest family and kind up its tree (family.ts). */
function nameOf(o: THREE.Object3D): string {
	for (let p: THREE.Object3D | null = o; p; p = p.parent) {
		const { family, kind } = p.userData;
		if (family) return kind ? `${family}:${kind}` : family;
	}
	return o.name || o.type;
}

/**
 * Every ID `d` can draw this frame, with the model each instance of a batch
 * draws: a model swapped under one instance is a new thing in its place.
 */
function present(d: Drawn, n: number, into: Shown) {
	const batch = d as unknown as THREE.BatchedMesh;
	if (batch.isBatchedMesh) {
		for (let i = 0; i < batch.maxInstanceCount; i++)
			try {
				if (batch.getVisibleAt(i))
					into.set(n + i * INSTANCE, batch.getGeometryIdAt(i));
			} catch {
				// A slot no instance holds.
			}
		return;
	}
	// A mesh's model is its geometry: a rider's level of detail swaps it in place.
	const model = (d as unknown as THREE.Mesh).geometry?.id ?? 0;
	const instanced = d as unknown as THREE.InstancedMesh;
	if (instanced.isInstancedMesh)
		for (let i = 0; i < instanced.count; i++) into.set(n + i * INSTANCE, model);
	else into.set(n, model);
}

/** Draws a tree as IDs into a target the drawing buffer's size and reads it back. */
export function idPass(renderer: THREE.WebGLRenderer) {
	const target = new THREE.WebGLRenderTarget(1, 1, {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		generateMipmaps: false,
	});
	const numbers = new WeakMap<THREE.Object3D, number>();
	const names = new Map<number, string>();
	const materials = new WeakMap<
		THREE.Object3D,
		{ src: Drawn['material']; id: Drawn['material'] }
	>();
	const size = new THREE.Vector2();
	const clear = new THREE.Color();
	let next = 1;
	let shown: Shown = new Map();

	function numberOf(o: THREE.Object3D): number {
		let n = numbers.get(o);
		if (n === undefined) {
			n = next++;
			numbers.set(o, n);
			names.set(n, nameOf(o));
		}
		return n;
	}

	function idOf(o: Drawn): Drawn['material'] {
		const had = materials.get(o);
		if (had?.src === o.material) {
			if (Array.isArray(had.src))
				had.src.forEach((m, i) => follow(m, (had.id as THREE.Material[])[i]));
			else follow(had.src, had.id as THREE.Material);
			return had.id;
		}
		const n = numberOf(o);
		const id = Array.isArray(o.material)
			? o.material.map((m) => idMaterial(m, n))
			: idMaterial(o.material, n);
		materials.set(o, { src: o.material, id });
		return id;
	}

	return {
		/** The tree `root` as `camera` sees it, one ID a pixel, rows bottom up. */
		draw(root: THREE.Object3D, camera: THREE.Camera): Ids {
			renderer.getDrawingBufferSize(size);
			if (target.width !== size.x || target.height !== size.y)
				target.setSize(size.x, size.y);
			const swapped: [Drawn, Drawn['material']][] = [];
			shown = new Map();
			const background = (root as THREE.Scene).background ?? null;
			renderer.getClearColor(clear);
			const alpha = renderer.getClearAlpha();
			const before = renderer.getRenderTarget();
			try {
				root.traverseVisible((o) => {
					const d = o as Drawn;
					if (!d.material) return;
					const src = d.material;
					d.material = idOf(d);
					swapped.push([d, src]);
					present(d, numberOf(d), shown);
				});
				if (background) (root as THREE.Scene).background = null;
				renderer.setRenderTarget(target);
				renderer.setClearColor(0x000000, 0);
				renderer.render(root, camera);
			} finally {
				renderer.setRenderTarget(before);
				renderer.setClearColor(clear, alpha);
				if (background) (root as THREE.Scene).background = background;
				for (const [d, m] of swapped) d.material = m;
			}
			const out = new Uint8Array(size.x * size.y * 4);
			renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, out);
			return new Uint32Array(out.buffer);
		},
		/** Every ID the last draw could have drawn, in view or not: what a frame holds before the camera and occlusion have their say. */
		shown: () => shown,
		/** The object numbers drawn in `root`'s tree. */
		numbersIn(root: THREE.Object3D): Set<number> {
			const out = new Set<number>();
			root.traverse((o) => {
				if ((o as Drawn).material) out.add(numberOf(o));
			});
			return out;
		},
		name: (id: number) => `${names.get(id & OBJECT_BITS) ?? '?'}#${id >>> 16}`,
		dispose() {
			target.dispose();
		},
	};
}

export type Pop = { name: string; px: number; frame: number };

/** The GPU checks on a composed world (#3222), each stepping or moving it by hand. */
export function idChecks(renderer: THREE.WebGLRenderer, world: Composed) {
	const pass = idPass(renderer);
	const { scene, camera } = world;
	const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)];
	return {
		/** Your figure's pixels, and how many of them anything but you and your marks covers. */
		mask() {
			const you = world.you;
			if (!you) return null;
			const full = pass.draw(scene, camera);
			const { px, by } = hidden(
				full,
				pass.draw(you, camera),
				pass.numbersIn(you.parent ?? you),
				renderer.getDrawingBufferSize(new THREE.Vector2()).x,
			);
			const named: Record<string, Cover> = {};
			for (const [id, c] of by) named[pass.name(id)] = c;
			return { px, by: named };
		},
		/** Pixels that flicker as the camera moves `mm` either way along its own right, then its up. */
		flicker(mm: number): number {
			let n = 0;
			for (const axis of axes) {
				const [a, b, c] = [-1, 0, 1].map((k) => {
					camera.translateOnAxis(axis, (k * mm) / 1000);
					camera.updateMatrixWorld();
					const ids = pass.draw(scene, camera);
					camera.translateOnAxis(axis, (-k * mm) / 1000);
					return ids;
				});
				n += flickers(a, b, c);
			}
			camera.updateMatrixWorld();
			return n;
		},
		/** Rides `frames` frames at 30 fps and names whatever appears in one at more than `minPx`. */
		ride(frames: number, minPx: number): Pop[] {
			const found: Pop[] = [];
			let before = pass.draw(scene, camera);
			for (let f = 1; f <= frames; f++) {
				const held = pass.shown();
				world.advanceBy(STEP_S);
				const now = pass.draw(scene, camera);
				for (const [id, px] of appeared(held, pass.shown(), before, now, minPx))
					found.push({ name: pass.name(id), px, frame: f });
				before = now;
			}
			return found;
		},
		dispose: pass.dispose,
	};
}
