// The ride picture's world (#4263): the road at a remembered metre, composed
// again as a held moment (ADR-0081: the world is keyed by place, so the same
// metre draws the same world), with you alone on it and the picture's own
// camera. Nothing in it carries a word (#4221). scene.ts draws it.
import * as THREE from 'three';
import { compose, type Composed, type MountOptions } from './compose';
import { framePicture } from './picture-camera';
import type { PictureMoment } from './picture.svelte';

/** The ride's world at `at`, framed for the picture: what the ride's own feeds put on the road is left off. */
export function pictureStill(opts: MountOptions, at: PictureMoment): Composed {
	const still = compose(
		{
			route: opts.route,
			world: opts.world,
			style: opts.style,
			ftp: opts.ftp,
			youId: opts.youId,
			neon: opts.neon,
			loop: opts.loop,
			grids: opts.grids,
			watts: at.watts,
			moment: { m: at.m, p: at.p },
		},
		null,
	);
	if (still.you)
		framePicture(still.camera, opts.route, opts.world, still.you, at.m);
	// The ground, the road and all the dressing within reach, brought to the lens.
	still.look();
	return still;
}

/** Whether `o` draws a painted face: every word and number the world draws is one (furniture.ts's paintedTexture). */
export function painted(o: THREE.Object3D): boolean {
	const m = (o as THREE.Mesh).material;
	if (!m) return false;
	return (Array.isArray(m) ? m : [m]).some(
		(x) => (x as THREE.MeshBasicMaterial).map instanceof THREE.CanvasTexture,
	);
}

/**
 * Hides everything painted under `root`: riders' names, the signs and
 * arches with their places, chalk, gates and the zone digit. Returns what
 * puts them back.
 */
export function wordless(root: THREE.Object3D): () => void {
	const hidden: THREE.Object3D[] = [];
	root.traverseVisible((o) => {
		if (painted(o)) hidden.push(o);
	});
	for (const o of hidden) o.visible = false;
	return () => {
		for (const o of hidden) o.visible = true;
	};
}
