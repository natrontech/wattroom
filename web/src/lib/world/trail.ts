// Your trail (#3663), the only glow in the world: a thin line on the road
// from your wheel back TRAIL_M metres, additive and unfogged, fading out
// along its length.
import * as THREE from 'three';
import { ROAD_LIFT, yOf } from './geometry';
import { across, bankOf } from './terrain/road-profile';
import { type Route } from '$lib/road/route';
import { at, curvature, leftOf } from '$lib/road/along';

/**
 * The trail lies on this much road behind you and fades out along it
 * (#3663): the chase frame's bottom edge meets the road about 3.3 m behind
 * the wheel, so the fade is seen to finish.
 */
const TRAIL_M = 3;
/** About a wheel wide: a line, never a wedge or a fill. */
const TRAIL_W = 0.08;
const TRAIL_N = 24;
export function makeTrail(color: string) {
	const rows = TRAIL_N + 1;
	const pos = new Float32Array(rows * 2 * 3);
	const col = new Float32Array(rows * 2 * 4);
	const c = new THREE.Color(color);
	for (let i = 0; i < rows; i++) {
		const a = (1 - i / TRAIL_N) * 0.85;
		col.set([c.r, c.g, c.b, a, c.r, c.g, c.b, a], i * 8);
	}
	const idx: number[] = [];
	for (let i = 0; i < TRAIL_N; i++)
		idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
	const g = new THREE.BufferGeometry();
	const attr = new THREE.BufferAttribute(pos, 3);
	g.setAttribute('position', attr);
	g.setAttribute('color', new THREE.BufferAttribute(col, 4));
	g.setIndex(idx);
	const mesh = new THREE.Mesh(
		g,
		new THREE.MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
			fog: false,
		}),
	);
	mesh.frustumCulled = false;
	return {
		mesh,
		/** Lays the line on the road behind `d`, in the lane you ride. */
		follow(route: Route, d: number, lane: number) {
			for (let i = 0; i < rows; i++) {
				const back = d - (i / TRAIL_N) * TRAIL_M;
				const p = at(route, route.loop ? back : Math.max(0, back));
				const { lx, lz } = leftOf(p.heading);
				const x = p.x + lx * lane;
				const z = p.z + lz * lane;
				// On the ribbon where your lane crosses it, banked as the ribbon is, a hair above it.
				const n = route.x.length - 1;
				const at0 = Math.round(back / route.step);
				const k = curvature(
					route,
					route.loop ? ((at0 % n) + n) % n : Math.min(Math.max(at0, 0), n),
				);
				const y =
					yOf(route, p.ele) + ROAD_LIFT + across(lane, bankOf(k)) + 0.03;
				const w = TRAIL_W / 2;
				attr.setXYZ(i * 2, x + lx * w, y, z + lz * w);
				attr.setXYZ(i * 2 + 1, x - lx * w, y, z - lz * w);
			}
			attr.needsUpdate = true;
		},
	};
}
