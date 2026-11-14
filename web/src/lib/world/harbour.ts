// A hamlet's small harbour on its lake (designs.ts names.hamlets harbour):
// a wooden jetty run out from the shore into the water, rowing boats moored
// along it, and a boathouse on the bank beside its root. Found from the
// design's spot by the water nearest it; one geometry coloured by vertex,
// drawn with the scene's dressing, so it adds no draw.
import * as THREE from 'three';
import type { Route } from '#lib/road/route.ts';
import { box, merge, tint } from './model';
import { roof } from './props';
import { yOf } from './road-surface';
import type { PropColors } from './styles';
import { FORMATION } from './terrain/road-profile';

/** The jetty: metres out over the water from the shore, back onto the land, its deck's width and height over the water, and its posts' spacing. */
export const JETTY = { out: 26, back: 4, wide: 2.4, deck: 0.7, post: 3.25 };
/** The boathouse: its width along the shore, its depth inland, and metres beside the jetty's root. */
export const BOATHOUSE = { wide: 6, deep: 9, beside: 12 };
/** Metres round each of a harbour's pieces its waterline grows no reed and holds no stone. */
export const HARBOUR_CLEAR_M = 16;
/** Metres off a road's edge every part of a harbour keeps. */
const ROAD_CLEAR_M = 6;
/** Farthest a harbour's spot may lie from its water. */
const REACH_M = 120;

type Place = {
	/** The level of the water over (x, z), or null on land. */
	waterAt: (x: number, z: number) => number | null;
	/** The drawn ground's height at (x, z), in metres. */
	heightAt: (x: number, z: number) => number;
	/** Whether (x, z) keeps `base` metres from every road. */
	clearOf: (x: number, z: number, base: number) => boolean;
};

/** Where a harbour lies: its shore point, the way out over the water, and the lake's level. */
export type Berth = {
	x: number;
	z: number;
	ox: number;
	oz: number;
	level: number;
};

/**
 * The shore nearest `spot` and the way straight out from it: the first
 * water met along any of 32 bearings from the spot, the nearest of them,
 * its way out the mean of the bearings that meet water within a few metres
 * of it, so the jetty runs square off the bank rather than along it.
 */
export function berthOf(
	spot: readonly [number, number],
	place: Place,
): Berth | null {
	const [sx, sz] = spot;
	const N = 32;
	const hits: { d: number; a: number; level: number }[] = [];
	for (let k = 0; k < N; k++) {
		const a = (k / N) * Math.PI * 2;
		for (let d = 0; d <= REACH_M; d += 1) {
			const level = place.waterAt(sx + Math.cos(a) * d, sz + Math.sin(a) * d);
			if (level === null) continue;
			// Open water as far as the jetty runs and its boats lie, not a stream crossed on the way.
			const past = d + JETTY.out + 4;
			if (
				place.waterAt(sx + Math.cos(a) * past, sz + Math.sin(a) * past) !== null
			)
				hits.push({ d, a, level });
			break;
		}
	}
	if (hits.length === 0) return null;
	const near = Math.min(...hits.map((h) => h.d));
	const close = hits.filter((h) => h.d <= near + 6);
	const ox = close.reduce((s, h) => s + Math.cos(h.a), 0);
	const oz = close.reduce((s, h) => s + Math.sin(h.a), 0);
	const len = Math.hypot(ox, oz) || 1;
	const first = close.find((h) => h.d === near)!;
	return {
		x: sx + Math.cos(first.a) * near,
		z: sz + Math.sin(first.a) * near,
		ox: ox / len,
		oz: oz / len,
		level: first.level,
	};
}

/** A rowing boat, bow to +z: a hull tapering to its bow, its gunwale a band of paint, two thwarts. */
function boat(c: PropColors, paint: string) {
	// Six sides drawn out along it: pointed at bow and stern, flared to its gunwale.
	const hull = new THREE.CylinderGeometry(0.75, 0.5, 0.5, 6, 1).scale(
		1,
		1,
		2.6,
	);
	return merge([
		tint(hull.translate(0, 0.25, 0), c.wood, paint),
		tint(box(1.0, 0.06, 0.24).translate(0, 0.42, -0.6), c.trunk),
		tint(box(0.8, 0.06, 0.24).translate(0, 0.42, 0.7), c.trunk),
	]);
}

/** A jetty from x = 0 (on the bank, `back` metres in) out along +z: a plank deck on posts into the water, a cross-head at its end. */
function jetty(c: PropColors, bed: number) {
	const length = JETTY.out + JETTY.back;
	const parts = [
		tint(
			box(JETTY.wide, 0.18, length).translate(
				0,
				JETTY.deck,
				length / 2 - JETTY.back,
			),
			c.wood,
		),
		// The head: wider, where a boat lies across its end.
		tint(
			box(5, 0.18, 2.4).translate(0, JETTY.deck + 0.03, JETTY.out - 1.2),
			c.wood,
		),
	];
	// Posts in pairs, down to the bed.
	for (let z = 0; z <= JETTY.out; z += JETTY.post)
		for (const s of [-1, 1]) {
			const h = JETTY.deck + bed + 0.6;
			parts.push(
				tint(
					box(0.22, h, 0.22).translate(
						s * (JETTY.wide / 2 - 0.05),
						JETTY.deck - h / 2 + 0.3,
						z,
					),
					c.trunk,
				),
			);
		}
	return merge(parts);
}

/** A boathouse, its doors to +z: timber walls on a stone footing, a steep roof, a dark door to the water. */
function boathouse(c: PropColors) {
	const { wide, deep } = BOATHOUSE;
	return merge([
		tint(box(wide + 0.2, 3, deep + 0.2).translate(0, -1, 0), c.stone),
		tint(box(wide, 3.2, deep).translate(0, 2.1, 0), c.wood),
		tint(roof(wide, deep, 2.8, 0.5).translate(0, 3.7, 0), c.roof),
		tint(
			new THREE.PlaneGeometry(wide * 0.62, 2.6).translate(
				0,
				1.8,
				deep / 2 + 0.02,
			),
			c.trunk,
		),
	]);
}

/** The pieces of a harbour, each where it stands: what the dressing draws, and what a test checks. */
export type HarbourPiece = {
	what: 'jetty' | 'boat' | 'boathouse';
	x: number;
	z: number;
	/** In metres, the scene's own heights (yOf turns it into the world's). */
	ele: number;
	/** Radians about +y: its +z points this way, toward the water for the jetty and the boathouse. */
	turn: number;
	geometry: THREE.BufferGeometry;
};

/**
 * A harbour at a hamlet's spot: its jetty, boats and boathouse, or none
 * where no water lies near the spot or a piece would stand on a road.
 */
export function harbourPieces(
	spot: readonly [number, number],
	place: Place,
	c: PropColors,
): HarbourPiece[] {
	const b = berthOf(spot, place);
	if (!b) return [];
	const turn = Math.atan2(b.ox, b.oz);
	// Left of the way out, along the shore.
	const lx = b.oz;
	const lz = -b.ox;
	const at = (along: number, out: number) =>
		[b.x + lx * along + b.ox * out, b.z + lz * along + b.oz * out] as const;
	// The bed under the jetty's end, at the lake's 0.3 a metre from its shore.
	const bed = Math.min(10, 0.3 * JETTY.out + 2);
	const out: HarbourPiece[] = [
		{
			what: 'jetty',
			x: b.x,
			z: b.z,
			ele: b.level,
			turn,
			geometry: jetty(c, bed),
		},
	];
	// Boats moored along it, bow out; the third across its head.
	const paints = [c.roof, c.shutter, c.wall];
	const moored: [along: number, out: number, turn: number][] = [
		[JETTY.wide / 2 + 0.9, 9, turn],
		[-(JETTY.wide / 2 + 0.9), 15, turn + 0.08],
		[0.8, JETTY.out + 1.6, turn + Math.PI / 2],
	];
	moored.forEach(([along, o, t], k) => {
		const [x, z] = at(along, o);
		out.push({
			what: 'boat',
			x,
			z,
			ele: b.level - 0.18,
			turn: t,
			geometry: boat(c, paints[k]),
		});
	});
	// The boathouse on the bank beside the jetty's root, its doors to the water, the side away from the nearer road.
	const sides = [1, -1].filter((s) => {
		const [x, z] = at(s * BOATHOUSE.beside, -BOATHOUSE.deep / 2 - 1);
		return (
			place.waterAt(x, z) === null &&
			place.clearOf(x, z, FORMATION + ROAD_CLEAR_M + BOATHOUSE.deep)
		);
	});
	if (sides.length > 0) {
		const [x, z] = at(sides[0] * BOATHOUSE.beside, -BOATHOUSE.deep / 2 - 1);
		out.push({
			what: 'boathouse',
			x,
			z,
			ele: Math.max(place.heightAt(x, z), b.level + 0.5),
			turn,
			geometry: boathouse(c),
		});
	}
	// None on a road: a jetty run out from a road's own bank is no harbour.
	const [rx, rz] = at(0, -JETTY.back);
	if (!place.clearOf(rx, rz, FORMATION + ROAD_CLEAR_M)) return [];
	return out;
}

/** A harbour's pieces as one geometry in the world's frame, for the scene's dressing. */
export function harbour(
	route: Route,
	pieces: readonly HarbourPiece[],
): THREE.BufferGeometry | null {
	if (pieces.length === 0) return null;
	const placed = pieces.map((p) =>
		p.geometry.clone().rotateY(p.turn).translate(p.x, yOf(route, p.ele), p.z),
	);
	const g = merge(placed);
	g.computeBoundingSphere();
	return g;
}
