// A game on the road (#3114), as the world stages it: Backyard Ramp's arch
// where the next round starts, Collective Ramp's fog sea rising round by
// round, and the riders a game has put out standing at the next hairpin,
// where the bunch hears the cowbell as it passes. Structure and scenery,
// never live data: nothing here glows (ADR-0005).
import * as THREE from 'three';
import {
	RoadsideStandMaxAheadM,
	RoadsideStandMinAheadM,
	RoadsideStandMoveSeconds,
} from '$lib/protocol';
import type { BunchView } from '$lib/channel/bunch-view';
import { at } from '$lib/road/along';
import { type Route } from '$lib/road/route';
import { DUR } from '$lib/motion/tokens';
import { damp } from '$lib/motion/damp';
import { disposeTree } from './dispose';
import { tag } from './family';
import { arch } from './furniture';
import { yOf } from './geometry';
import type { Style } from './styles';
import type { World } from './world';

/** Metres the bunch rides past a stand before its rider may move on. */
const PASSED_M = 60;
/** How far under the bunch the fog lies in round 1, and how much closer it creeps each round. */
// ponytail: a look, not a rule; tune with real collective rounds.
const FOG_DEPTH_M = 48;
const FOG_RISE_M = 6;
/** The nearest the fog comes: it creeps toward the riders, never over them. */
const FOG_CLEAR_M = 10;
/** Half the fog sea's side, metres: past the fog's own horizon. */
const FOG_HALF_M = 30_000;
/** Metres ahead past which the round's arch still follows the bunch's speed: too far to see it move. */
const AIM_M = 1000;

/**
 * Where a rider put out stands next (SPEC "The roadside"): the first hairpin
 * 300 m to 5 km ahead of the bunch at `m`, laps unrolled, else 300 m ahead.
 */
export function nextStand(
	m: number,
	hairpins: number[],
	length: number,
	loop: boolean,
): number {
	const from = m + RoadsideStandMinAheadM;
	const to = m + RoadsideStandMaxAheadM;
	const laps = loop ? Math.floor(from / length) : 0;
	for (let lap = laps; lap <= laps + (loop ? 1 : 0); lap++)
		for (const h of hairpins) {
			const u = h + lap * length;
			if (u >= from && u <= to) return u;
		}
	return from;
}

/** The fog sea's height in round `round`, metres above sea, under the bunch riding at `ele`: closer every round. */
export function fogEle(round: number, ele: number): number {
	return ele - Math.max(FOG_CLEAR_M, FOG_DEPTH_M - (round - 1) * FOG_RISE_M);
}

type Stand = { m: number; since: number };

export function makeGameRoad(route: Route, world: World, style: Style) {
	const group = new THREE.Group();
	const hairpins = world.markers
		.filter((k) => k.kind === 'hairpin')
		.map((k) => k.d)
		.sort((a, b) => a - b);
	const stands = new Map<string, Stand>();
	let held: { round: number; m: number; mesh: THREE.Group } | null = null;
	let fog: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null =
		null;
	let fogY = NaN;
	let lastM = NaN;
	let rang = false;

	function archAt(round: number, m: number) {
		if (held) {
			group.remove(held.mesh);
			disposeTree(held.mesh);
		}
		const p = at(route, m);
		const mesh = arch(
			route,
			{
				x: p.x,
				y: p.ele,
				z: p.z,
				turn: [-Math.cos(p.heading), -Math.sin(p.heading)],
				label: `ROUND ${round}`,
			},
			style,
		);
		mesh.userData.label = `ROUND ${round}`;
		group.add(tag('dressing', mesh, 'arch'));
		held = { round, m, mesh };
	}

	/** Where `furniture.arch` stands an arch at `m`: on the road, square to it. */
	function put(mesh: THREE.Object3D, m: number) {
		const p = at(route, m);
		mesh.position.set(p.x, yOf(route, p.ele) + 0.1, p.z);
		mesh.rotation.y = p.heading;
	}

	function dropArch() {
		if (!held) return;
		group.remove(held.mesh);
		disposeTree(held.mesh);
		held = null;
	}

	function fogSea(): NonNullable<typeof fog> {
		if (fog) return fog;
		fog = new THREE.Mesh(
			new THREE.PlaneGeometry(FOG_HALF_M * 2, FOG_HALF_M * 2).rotateX(
				-Math.PI / 2,
			),
			// The sky's own horizon, a shade lighter: the scene's fog takes it into the distance.
			new THREE.MeshBasicMaterial({
				color: new THREE.Color(style.sky.horizon).lerp(
					new THREE.Color(1, 1, 1),
					0.25,
				),
			}),
		);
		fog.visible = false;
		group.add(tag('sky', fog, 'fog-sea'));
		return fog;
	}

	return {
		group,
		/**
		 * The game's road this frame, from the bunch's view: the arch, the fog
		 * and the stands. `clock` is the ride's own seconds; `steady` is
		 * reduced motion, where the fog steps instead of rising.
		 */
		update(view: BunchView, clock: number, real: number, steady: boolean) {
			const play = view.play;
			// The round that starts next stands where the bunch will be when this
			// one ends: aimed from the bunch's speed while it is too far off to
			// see move, then held, so it never slides once a rider can see it.
			if (
				play?.mode === 'backyard-ramp' &&
				play.roundEndsAt !== undefined &&
				view.at !== undefined
			) {
				const next = play.round + 1;
				const aim =
					view.m + (view.mps * Math.max(0, play.roundEndsAt - view.at)) / 1000;
				// A standing bunch has no speed to aim by: the arch waits for it to roll.
				if (held?.round !== next) {
					if (view.mps > 1) archAt(next, aim);
				} else if (held.m - view.m > AIM_M && held.m !== aim) {
					held.m = aim;
					put(held.mesh, aim);
				}
			} else dropArch();

			if (play?.mode === 'collective-ramp') {
				const sea = fogSea();
				const want = yOf(route, fogEle(play.round, at(route, view.m).ele));
				// Eased under the bunch as it climbs and as a round turns; a held stamp under reduced motion.
				fogY =
					steady || !sea.visible || Number.isNaN(fogY)
						? want
						: fogY + (want - fogY) * damp(DUR.draw / 1000, real);
				sea.position.y = fogY;
				sea.visible = true;
			} else if (fog) fog.visible = false;

			const out = new Set(play?.out ?? []);
			for (const id of stands.keys()) if (!out.has(id)) stands.delete(id);
			for (const id of out) {
				const s = stands.get(id);
				const moved = !s || clock - s.since >= RoadsideStandMoveSeconds;
				if (!s || (moved && view.m > s.m + PASSED_M))
					stands.set(id, {
						m: nextStand(view.m, hairpins, route.length, route.loop),
						since: clock,
					});
			}
			// The cowbell, once a tick at most: the bunch rode past somebody standing.
			rang = false;
			if (view.m !== lastM) {
				for (const s of stands.values())
					if (lastM < s.m && s.m <= view.m) rang = true;
				lastM = view.m;
			}
		},
		/** Where each rider put out stands, metres along the road, laps unrolled. */
		stands(): ReadonlyMap<string, number> {
			return new Map([...stands].map(([id, s]) => [id, s.m]));
		},
		/** The bunch rode past a stand on this frame's tick. */
		get rang() {
			return rang;
		},
		/** The fog sea under the eye, wherever it looks from. */
		follow(eye: THREE.Vector3) {
			fog?.position.set(eye.x, fog.position.y, eye.z);
		},
	};
}
export type GameRoad = ReturnType<typeof makeGameRoad>;
