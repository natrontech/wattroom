import * as THREE from 'three';
import { B, SLOTS } from '../src/lib/world/figure/contract';
import { buildFigure, type Palette } from '../src/lib/world/figure/figure';
import { resolveKit } from '../src/lib/world/figure/kit';
import { figureMaterial } from '../src/lib/world/figure/material';

/**
 * What world-figure.spec.ts bundles into a page: one figure in the real
 * material, drawn side on, and how much of its rear wheel changes when the
 * wheel turns half a spoke — at rest, and at a given sweep a frame.
 */
const palette = Object.fromEntries(
	SLOTS.map((s) => [
		s,
		new THREE.Color(
			s === 'spokes' ? 1 : 0.15,
			s === 'spokes' ? 1 : 0.15,
			s === 'spokes' ? 1 : 0.15,
		),
	]),
) as Palette;
const kit = resolveKit();
const mesh = buildFigure(kit, {
	lod: 0,
	palette,
	material: figureMaterial(kit, new THREE.Color(1, 1, 1)),
});
const { bk } = mesh.userData.rig;
const renderer = new THREE.WebGLRenderer({
	antialias: true,
	preserveDrawingBuffer: true,
});
renderer.setSize(240, 240, false);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(
	mesh,
	new THREE.AmbientLight(0xffffff, 1),
	new THREE.DirectionalLight(0xffffff, 1),
);
const s = 0.125; // the spokes inside 0.18 m: not the rim, whose decals turn once a revolution and rightly stay sharp
const camera = new THREE.OrthographicCamera(-s, s, s, -s, 0.1, 10);
camera.position.set(bk.rear.x, bk.rear.y, 3);

function draw(angle: number): Uint8Array {
	const bone = mesh.skeleton.bones[B.rearWheel];
	bone.matrix
		.makeTranslation(bk.rear.x, bk.rear.y, 0)
		.multiply(new THREE.Matrix4().makeRotationZ(-angle));
	bone.matrixWorldNeedsUpdate = true;
	renderer.render(scene, camera);
	const gl = renderer.getContext();
	const px = new Uint8Array(240 * 240 * 4);
	gl.readPixels(0, 0, 240, 240, gl.RGBA, gl.UNSIGNED_BYTE, px);
	return px;
}

/** Mean absolute change, 0–1, in the wheel's pixels between two frames half a spoke apart. */
export function change(sweep: number): number {
	mesh.userData.wheelDelta = sweep;
	const half =
		Math.PI / (kit.wheels.rear.type === 'spoked' ? kit.wheels.rear.spokes : 3);
	const a = draw(0.1);
	const b = draw(0.1 + half);
	let sum = 0;
	for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
	return sum / (a.length / 4) / 255;
}

/** The period of the rear wheel's spokes, radians. */
export const period = (): number =>
	(2 * Math.PI) /
	(kit.wheels.rear.type === 'spoked' ? kit.wheels.rear.spokes : 3);
