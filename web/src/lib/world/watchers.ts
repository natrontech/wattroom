// People by the road in the villages, in the cozy room's own art: they stand
// on the verge facing the road and wave now and then (draw-rider.ts). Pixel
// 3D only, a handful at each village, drawn only near you, so they cost a
// few draws at most. Where each stands is a function of the village and its
// seat, so every screen on the road sees the same faces in the same places.
import * as THREE from 'three';
import { drawWatcher } from '$lib/lounge/draw-rider';
import { dress } from '$lib/lounge/figures';
import { at, leftOf } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import { makeAvatar, sheetOf } from './avatar';
import { tag } from './family';
import { yOf } from './geometry';
import { ROAD_W } from './terrain/road-profile';

/** Faces a village is drawn from: each sheet is shared by everyone who wears it. */
const LOOKS = 6;
/** People at a village, and how far along the road they spread. */
const PER_VILLAGE = 6;
const SPREAD_M = 70;
/** Only those this near you are drawn. */
const NEAR_M = 260;

export function makeWatchers(route: Route, villages: readonly { d: number }[]) {
	const group = new THREE.Group();
	const sheets = Array.from({ length: LOOKS }, (_, i) =>
		sheetOf(dress({ id: `watcher-${i}`, name: '' }), (g, _view, frame) =>
			drawWatcher(g, dress({ id: `watcher-${i}`, name: '' }), frame),
		),
	);
	const people = villages.flatMap((v, k) =>
		Array.from({ length: PER_VILLAGE }, (_, i) => {
			const d = v.d - SPREAD_M / 2 + ((i + 0.5) / PER_VILLAGE) * SPREAD_M;
			const side = (i + k) % 2 === 0 ? 1 : -1;
			const avatar = makeAvatar(sheets[(i * 7 + k * 3) % LOOKS]);
			const seat = new THREE.Group().add(
				tag('figures', avatar.mesh, 'watcher'),
			);
			const p = at(route, Math.max(0, Math.min(route.length, d)));
			const { lx, lz } = leftOf(p.heading);
			const lane = side * (ROAD_W / 2 + 1.8 + ((i * 37) % 10) / 10);
			seat.position.set(
				p.x + lx * lane,
				yOf(route, p.ele) + 0.1,
				p.z + lz * lane,
			);
			// Turned to face the road, so the camera sees them from the front.
			seat.rotation.y = p.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
			seat.visible = false;
			group.add(seat);
			return { d, seat, avatar, phase: i * 1.7 + k };
		}),
	);
	return {
		group,
		/** This frame: who is near enough to draw, and where each is in their wave. */
		update(you: number, t: number) {
			for (const p of people) {
				p.seat.visible = Math.abs(p.d - you) < NEAR_M;
				if (p.seat.visible) p.avatar.set(t * 2.2 + p.phase, 1, false);
			}
		},
		dispose() {
			for (const p of people) p.avatar.dispose();
			for (const s of sheets) s.dispose();
		},
	};
}
