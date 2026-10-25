// Your ghosts on the road (#3245, ADR-0068): your own figure in your own
// kit, see-through, riding where an earlier ride of yours was at this second.
// A ghost is a memory, neither live data nor chrome: no zone ring, no
// contact shadow, no name tag, no trail and no glow, and nothing shelters
// behind it (ADR-0077). Every ghost is one figure posed once a frame and
// drawn as instances of it, so up to three cost one draw (#3082).
import * as THREE from 'three';
import { at } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import { LANE } from './bunch';
import { KEEP_RIGHT, placeOn, viewerOf } from './crew';
import { tag } from './family';
import { RiderAnimator } from './figure/animator';
import { buildFigure, type Figure } from './figure/figure';
import { figureMaterial } from './figure/material';
import { pose } from './figure/pose';
import type { Loadout } from './loadout';
import { outfitOf } from './outfit';
import type { Style } from './styles';

/** At most this many at once (docs/spec/roads.md "Road segments and ghosts"). */
export const MOST_GHOSTS = 3;
/** How much of a ghost shows (#3245): clearly lighter than a live rider. */
export const GHOST_OPACITY = 0.4;
/** A ghost rides at about this share of your FTP: its legs turn, nothing reads it. */
const GHOST_EFFORT = 0.7;

/** Where a ghost is this frame: metres along the road, and its speed. */
export type GhostAt = { d: number; v: number };

/**
 * One skinned figure flagged as instanced: three draws an object that is
 * both in one call, its skeleton's pose for every instance and each
 * instance's matrix after it (project_vertex). The ghosts share the one
 * pose; what sets them apart is where they ride.
 */
type InstancedFigure = Figure & {
	readonly isInstancedMesh: true;
	instanceMatrix: THREE.InstancedBufferAttribute;
	instanceColor: null;
	morphTexture: null;
	count: number;
	dispose(): void;
};

function instanced(figure: Figure): InstancedFigure {
	const matrices = new THREE.InstancedBufferAttribute(
		new Float32Array(16 * MOST_GHOSTS),
		16,
	).setUsage(THREE.DynamicDrawUsage);
	return Object.assign(figure, {
		isInstancedMesh: true as const,
		instanceMatrix: matrices,
		instanceColor: null,
		morphTexture: null,
		count: 0,
		// What InstancedMesh.dispose does: the renderer lets go of the matrices' buffer.
		dispose: () =>
			(figure as THREE.Object3D).dispatchEvent({
				type: 'dispose',
			} as never),
	});
}

/** Your ghosts, in `loadout`: the kit your own figure wears in this look. */
export function makeGhosts(style: Style, loadout: Loadout, ftp: number) {
	const outfit = outfitOf(loadout, style.kit, viewerOf(style));
	const material = figureMaterial(outfit.kit, outfit.decal, outfit.jersey);
	// Blended, not dithered: a dithered figure is a rider arriving or leaving
	// (#3098). It writes no depth, so every part shows through every other
	// whatever order the figure was built in, and three in one draw need no sort.
	material.transparent = true;
	material.opacity = GHOST_OPACITY;
	material.alphaToCoverage = false;
	material.depthWrite = false;
	const figure = buildFigure(outfit.kit, {
		palette: outfit.palette,
		material,
	});
	material.userData.u.uTorso.value = figure.userData.rig.dims.torso;
	const mesh = instanced(figure);
	// After the road's own see-through marks: a ghost over your ring reads as in front of it.
	mesh.renderOrder = 1;
	const anim = new RiderAnimator(figure, { seed: 7, remote: true });
	const place = new THREE.Object3D();
	// The figure's +X forward becomes the world's heading, as crew.ts turns each rider.
	const turn = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
	const m = new THREE.Matrix4();
	const group = new THREE.Group().add(tag('figures', mesh, 'ghost'));

	return {
		group,
		/** How many ghosts the last frame drew, as a capture reports it. */
		get shown() {
			return mesh.visible ? mesh.count : 0;
		},
		/** Places and poses the ghosts; none in the orbit view, where riders are beads. */
		update(route: Route, ghosts: GhostAt[], dt: number, overview: boolean) {
			const shown = overview ? [] : ghosts.slice(0, MOST_GHOSTS);
			mesh.count = shown.length;
			mesh.visible = shown.length > 0;
			if (!shown.length) return;
			// Beside you, a lane to your left each, so a ghost level with you rides abreast.
			shown.forEach((g, i) => {
				placeOn(place, route, g.d, KEEP_RIGHT + (i + 1) * LANE);
				place.updateMatrix();
				m.multiplyMatrices(place.matrix, turn);
				m.toArray(mesh.instanceMatrix.array, i * 16);
			});
			mesh.instanceMatrix.needsUpdate = true;
			const lead = shown[0];
			const moving = lead.v > 0.5;
			pose(
				figure,
				anim.update(dt, {
					power: moving ? ftp * GHOST_EFFORT : 0,
					ftp,
					speed: lead.v,
					grade: at(route, lead.d).grade,
				}),
			);
		},
	};
}

export type Ghosts = ReturnType<typeof makeGhosts>;
