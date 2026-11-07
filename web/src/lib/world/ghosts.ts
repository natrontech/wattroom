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
import type { Figure as Figure2D } from '$lib/lounge/scene';
import { RiderAnimator } from './figure/animator';
import { buildFigure, type Figure, type Palette } from './figure/figure';
import { figureMaterial } from './figure/material';
import { pose } from './figure/pose';
import { makeRiderSprite, riderSheet } from './rider-sprite';
import type { Loadout } from './loadout';
import { outfitOf } from './outfit';
import type { Style } from './styles';

/** At most this many at once (docs/spec/roads.md "Road segments and ghosts"). */
export const MOST_GHOSTS = 3;
/** How much of a ghost shows (#3245): clearly lighter than a live rider. */
export const GHOST_OPACITY = 0.4;
/** How far each kit colour goes toward white (#3245, v3-roads): your kit, paled, so a ghost reads lighter than anyone live. */
export const GHOST_PALE = 0.6;
/** A ghost rides at about this share of your FTP: its legs turn, nothing reads it. */
const GHOST_EFFORT = 0.7;

const WHITE = new THREE.Color(1, 1, 1);
const pale = (c: THREE.Color) => c.clone().lerp(WHITE, GHOST_PALE);

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

/** Radians a crank turns a metre ridden, near enough: a ghost's legs only need to look ridden. */
const CRANK_PER_M = 1.1;

/** Your ghosts in Diorama 3D: your own sprite, paled and see-through, a lane to your left each. */
export function makeDioramaGhosts(you: Figure2D) {
	const sheet = riderSheet(you);
	const sprites = Array.from({ length: MOST_GHOSTS }, () => {
		const sprite = makeRiderSprite(sheet, {
			opacity: GHOST_OPACITY,
			pale: GHOST_PALE,
		});
		const seat = new THREE.Group().add(tag('figures', sprite.mesh, 'ghost'));
		return { sprite, seat };
	});
	const group = new THREE.Group().add(...sprites.map((s) => s.seat));
	let crank = 0;
	let drawn = 0;
	return {
		group,
		get shown() {
			return drawn;
		},
		update(route: Route, ghosts: GhostAt[], dt: number, overview: boolean) {
			const shown = overview ? [] : ghosts.slice(0, MOST_GHOSTS);
			drawn = shown.length;
			crank += dt * (shown[0]?.v ?? 0) * CRANK_PER_M;
			sprites.forEach(({ sprite, seat }, i) => {
				seat.visible = i < shown.length;
				if (!seat.visible) return;
				placeOn(seat, route, shown[i].d, KEEP_RIGHT + (i + 1) * LANE);
				sprite.set(crank + i, 1, false);
			});
		},
	};
}

/** Your ghosts, in `loadout`: the kit your own figure wears in this look. */
export function makeGhosts(style: Style, loadout: Loadout, ftp: number) {
	const outfit = outfitOf(loadout, style.kit, viewerOf(style));
	const palette = Object.fromEntries(
		Object.entries(outfit.palette).map(([slot, c]) => [slot, pale(c)]),
	) as Palette;
	const { jersey } = outfit;
	const material = figureMaterial(outfit.kit, pale(outfit.decal), {
		pattern: jersey.pattern,
		b: pale(jersey.b),
		c: pale(jersey.c),
	});
	// Blended, not dithered: a dithered figure is a rider arriving or leaving
	// (#3098). It writes no depth, so every part shows through every other
	// whatever order the figure was built in, and three in one draw need no sort.
	material.transparent = true;
	material.opacity = GHOST_OPACITY;
	material.alphaToCoverage = false;
	material.depthWrite = false;
	const figure = buildFigure(outfit.kit, { palette, material });
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

export type Ghosts =
	ReturnType<typeof makeGhosts> | ReturnType<typeof makeDioramaGhosts>;
