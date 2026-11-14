// What grows and lies at the water's edge (water.ts ShorePoint): reeds in
// clumps on a gentle shore, stones where the bank is steep, boulders along a
// stream and where it falls. On the waterline the drawn ground leaves the
// water at, never on a road; one geometry, coloured by vertex, for the flat
// material.
import * as THREE from 'three';
import type { Route } from '#lib/road/route.ts';
import { facets, merge, tint } from './model';
import { yOf } from './road-surface';
import { FORMATION } from './terrain/road-profile';
import type { PropColors } from './styles';
import type { ShorePoint } from './water';

/** A shore whose dry ground rises gentler than this is a reed bed's; steeper, a stony one. */
export const GENTLE_BANK = 0.3;
/** The share of the waterline's points (one a lattice edge, about every 10 m) that grow reeds on a gentle shore, and that hold a stone on a steep one. */
export const SHORE_SHARE = { reeds: 0.35, stones: 0.25 };
/** The share of a stream's bank points, a bank every 10 m, that hold a boulder: calm, and where it falls white. */
export const STREAM_SHARE = { calm: 0.12, white: 0.4 };
/** Metres off a road's edge inside which nothing is put. */
const ROAD_CLEAR_M = 3;
/** Metres from a road past which a shore is left bare: too far to see a reed. */
const ROAD_REACH_M = 500;

/** A clump of reeds a metre or so tall, standing in the water's edge: blades of two greens and a few brown heads. */
function reedClump(c: PropColors): THREE.BufferGeometry {
	const parts: THREE.BufferGeometry[] = [];
	const blades = 5;
	for (let i = 0; i < blades; i++) {
		const a = (i / blades) * Math.PI * 2 + (i % 2) * 0.7;
		const r = 0.12 + (i % 3) * 0.1;
		const h = 0.9 + ((i * 37) % 5) * 0.12;
		const lean = 0.12 + (i % 2) * 0.08;
		parts.push(
			tint(
				new THREE.CylinderGeometry(0, 0.05, h, 3, 1, true)
					.translate(0, h / 2, 0)
					.rotateZ(lean * Math.cos(a))
					.rotateX(lean * Math.sin(a))
					.translate(Math.cos(a) * r, 0, Math.sin(a) * r),
				i % 2 ? c.leaf : c.leafLight,
			),
		);
		if (i % 2 === 0 && i < 4)
			parts.push(
				tint(
					new THREE.CylinderGeometry(0.05, 0.05, 0.24, 3, 1, true)
						.translate(0, h * 0.82, 0)
						.rotateZ(lean * Math.cos(a))
						.rotateX(lean * Math.sin(a))
						.translate(Math.cos(a) * r, 0, Math.sin(a) * r),
					c.trunk,
				),
			);
	}
	return merge(parts);
}

/** A stone, eight faces each shaded its own way: lying half in the water. */
function stone(c: PropColors): THREE.BufferGeometry {
	const g = new THREE.OctahedronGeometry(0.6, 0);
	g.rotateY(0.4).scale(1.3, 0.7, 1);
	return merge([facets(g, c.rock, c.stone, -0.4, 0.4)]);
}

/** Copies `part` into the arrays, turned `turn` about its foot, scaled `s`, at (x, y, z). */
function put(
	into: { pos: number[]; nor: number[]; col: number[] },
	part: THREE.BufferGeometry,
	x: number,
	y: number,
	z: number,
	turn: number,
	s: number,
) {
	const p = part.attributes.position;
	const n = part.attributes.normal;
	const col = part.attributes.color;
	const cos = Math.cos(turn);
	const sin = Math.sin(turn);
	for (let i = 0; i < p.count; i++) {
		const px = p.getX(i) * s;
		const pz = p.getZ(i) * s;
		into.pos.push(
			x + px * cos + pz * sin,
			y + p.getY(i) * s,
			z - px * sin + pz * cos,
		);
		const nx = n.getX(i);
		const nz = n.getZ(i);
		into.nor.push(nx * cos + nz * sin, n.getY(i), -nx * sin + nz * cos);
		into.col.push(col.getX(i), col.getY(i), col.getZ(i));
	}
}

/**
 * The shore's dressing for the waterline's points: a reed clump on a gentle
 * still shore, a stone on a steep one, a boulder now and then along a
 * stream's banks and more where it falls white; nothing within 3 m of a
 * road's edge, nor farther than 500 m from one.
 */
export function shoreDressing(
	route: Route,
	points: readonly ShorePoint[],
	/** Whether (x, z) keeps `base` metres off every road's centre (terrain/ground.ts). */
	clearOf: (x: number, z: number, reach: number) => boolean,
	c: PropColors,
): THREE.BufferGeometry | null {
	const reeds = reedClump(c);
	const rock = stone(c);
	const into = {
		pos: [] as number[],
		nor: [] as number[],
		col: [] as number[],
	};
	for (const p of points) {
		const pick = p.running
			? p.k < (p.foam > 0.5 ? STREAM_SHARE.white : STREAM_SHARE.calm)
				? 'stone'
				: null
			: p.bank < GENTLE_BANK
				? p.k < SHORE_SHARE.reeds
					? 'reeds'
					: null
				: p.k < SHORE_SHARE.stones
					? 'stone'
					: null;
		if (
			!pick ||
			!clearOf(p.x, p.z, FORMATION + ROAD_CLEAR_M) ||
			clearOf(p.x, p.z, ROAD_REACH_M)
		)
			continue;
		const y = yOf(route, p.level);
		const turn = p.k * 97;
		const size = 0.9 + ((p.k * 7919) % 1) * 0.9;
		if (pick === 'reeds') {
			// A bed of them: two or three clumps along the shore.
			for (let k = 0; k < 1 + (Math.round(p.k * 1000) % 2); k++)
				put(
					into,
					reeds,
					p.x + Math.cos(turn + k * 2.4) * 1.6 * k,
					y - 0.25,
					p.z + Math.sin(turn + k * 2.4) * 1.6 * k,
					turn + k,
					size * (1 - k * 0.15),
				);
		} else if (p.running) put(into, rock, p.x, y - 0.4, p.z, turn, size * 1.2);
		else put(into, rock, p.x, y, p.z, turn, size);
	}
	reeds.dispose();
	rock.dispose();
	if (into.pos.length === 0) return null;
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(into.pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(into.nor, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(into.col, 3));
	g.computeBoundingSphere();
	return g;
}
