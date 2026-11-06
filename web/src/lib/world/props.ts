// Low-poly prop models built in code (ADR-0092): each is one merged geometry
// with its colours flat per face or per part, so a whole village is one
// batched draw. Proportions are chunky on purpose: a prop is a handful of
// faces that reads at 30 m from a chase camera. The trees are trees.ts's.
import * as THREE from 'three';
import { box, cyl, facets, merge, tint } from './model';
import type { PropColors } from './styles';

export * from './trees';

// A gabled roof as an extruded triangle.
function roof(w: number, d: number, h: number, overhang: number) {
	const s = new THREE.Shape();
	s.moveTo(-w / 2 - overhang, 0);
	s.lineTo(0, h);
	s.lineTo(w / 2 + overhang, 0);
	s.lineTo(-w / 2 - overhang, 0);
	const g = new THREE.ExtrudeGeometry(s, {
		depth: d + overhang * 2,
		bevelEnabled: false,
	});
	return g.translate(0, 0, -(d + overhang * 2) / 2);
}

// Buildings stand on a stone base that reaches 3 m into the ground, so a
// house on a slope sits on its foundation instead of floating off a corner.
const foundation = (w: number, d: number, c: PropColors) =>
	tint(box(w, 3.4, d).translate(0, -1.4, 0), c.stone);

/**
 * A window on a wall facing `a`: its glass, a pale frame and painted shutters
 * folded back, each a flat face a hair off the one behind it. `s`: the window
 * sits at (x, y, z), and the shutters run along the wall.
 */
function shuttered(
	c: PropColors,
	w: number,
	h: number,
	x: number,
	y: number,
	z: number,
	a: number,
) {
	const plane = (
		pw: number,
		ph: number,
		across: number,
		out: number,
		col: string,
	) =>
		tint(
			new THREE.PlaneGeometry(pw, ph)
				.translate(across, 0, out)
				.rotateY(a)
				.translate(x, y, z),
			col,
		);
	return [
		plane(w + 0.34, h + 0.34, 0, 0, c.post),
		plane(w, h, 0, 0.02, c.band),
		plane(0.46, h + 0.2, -(w / 2 + 0.42), 0.02, c.shutter),
		plane(0.46, h + 0.2, w / 2 + 0.42, 0.02, c.shutter),
	];
}

const EAST_FACE = Math.PI / 2;
const WEST_FACE = -Math.PI / 2;

// A Swiss house: a stone footing, white masonry ground floor and a timber upper
// floor under deep eaves, shuttered windows on every side, and a balcony of
// geraniums over the south gable.
export function house(c: PropColors) {
	const onSides = (y: number, sideX: number, zs: number[]) =>
		zs.flatMap((z) => [
			...shuttered(c, 1, 1.1, sideX, y, z, EAST_FACE),
			...shuttered(c, 1, 1.1, -sideX, y, z, WEST_FACE),
		]);
	return merge([
		foundation(9.3, 11.3, c),
		tint(box(9.1, 0.7, 11.1).translate(0, 0.35, 0), c.stone),
		tint(box(9, 3.2, 11).translate(0, 1.6, 0), c.wall),
		tint(box(9.2, 2.8, 11.2).translate(0, 4.6, 0), c.wood),
		tint(box(9.34, 0.2, 11.34).translate(0, 3.2, 0), c.trunk),
		tint(box(9.34, 0.14, 11.34).translate(0, 5.2, 0), c.trunk),
		tint(roof(9.2, 11.2, 4.2, 1.4).translate(0, 6, 0), c.roof),
		tint(box(0.9, 2, 0.9).translate(2.2, 9.4, 1.5), c.stone),
		tint(box(1.1, 0.2, 1.1).translate(2.2, 10.3, 1.5), c.trunk),
		...onSides(1.8, 4.52, [-3.2, 0, 3.2]),
		...onSides(4.4, 4.62, [-3.2, 0, 3.2]),
		...shuttered(c, 1, 1.1, -2.2, 1.8, 5.52, 0),
		...shuttered(c, 1, 1.1, 2.2, 1.8, 5.52, 0),
		...shuttered(c, 1, 1.1, -2.2, 4.4, 5.62, 0),
		...shuttered(c, 1, 1.1, 2.2, 4.4, 5.62, 0),
		...shuttered(c, 1, 1.1, -2.2, 1.8, -5.52, Math.PI),
		...shuttered(c, 1, 1.1, 2.2, 1.8, -5.52, Math.PI),
		// The balcony, its rail and the flowers along it.
		tint(box(8, 0.16, 1.1).translate(0, 3.42, 6.15), c.wood),
		tint(box(8, 0.8, 0.1).translate(0, 3.88, 6.68), c.wood),
		tint(box(7.8, 0.3, 0.34).translate(0, 4.44, 6.72), c.leafLight),
		tint(box(7.2, 0.2, 0.4).translate(0, 4.66, 6.72), c.flower),
	]);
}

// A Reformed church: nave, tall square tower, needle spire.
export function church(c: PropColors) {
	return merge([
		foundation(10.3, 29, c),
		tint(box(10, 7, 18).translate(0, 3.5, 2), c.wall),
		tint(roof(10, 18, 5, 0.6).translate(0, 7, 2), c.roof),
		tint(box(4.6, 16, 4.6).translate(0, 8, -8.5), c.wall),
		tint(
			new THREE.ConeGeometry(3.4, 11, 4)
				.rotateY(Math.PI / 4)
				.translate(0, 21.5, -8.5),
			c.roof,
		),
	]);
}

export function barn(c: PropColors) {
	const door = (z: number, a: number) =>
		tint(
			new THREE.PlaneGeometry(4.4, 3.6).rotateY(a).translate(0, 1.8, z),
			c.trunk,
		);
	return merge([
		foundation(12.2, 18.2, c),
		tint(box(12, 5, 18).translate(0, 2.5, 0), c.wood),
		tint(box(12.16, 0.2, 18.16).translate(0, 3.4, 0), c.trunk),
		tint(roof(12, 18, 5.5, 1.2).translate(0, 5, 0), c.roof),
		door(9.03, 0),
		door(-9.03, Math.PI),
		tint(new THREE.PlaneGeometry(1.8, 1.5).translate(0, 6.4, 9.03), c.trunk),
	]);
}

// An alpine hut: stone plinth, timber box, heavy low roof.
export function hut(c: PropColors) {
	return merge([
		foundation(7.2, 8.2, c),
		tint(box(7, 1.6, 8).translate(0, 0.8, 0), c.stone),
		tint(box(6.6, 2.6, 7.6).translate(0, 2.9, 0), c.wood),
		tint(roof(6.6, 7.6, 2.4, 1).translate(0, 4.2, 0), c.stone),
		tint(new THREE.PlaneGeometry(1.1, 2).translate(-1.6, 1.1, 4.03), c.trunk),
		...shuttered(c, 0.8, 0.8, 1.4, 2.9, 3.82, 0),
		...shuttered(c, 0.8, 0.8, 3.32, 2.9, 1.2, EAST_FACE),
		...shuttered(c, 0.8, 0.8, -3.32, 2.9, -1.2, WEST_FACE),
	]);
}

export function chapel(c: PropColors) {
	return merge([
		foundation(5.2, 8.2, c),
		tint(box(5, 4.2, 8).translate(0, 2.1, 0), c.wall),
		tint(roof(5, 8, 3, 0.4).translate(0, 4.2, 0), c.roof),
		tint(box(1.4, 2.2, 1.4).translate(0, 7.7, 3.2), c.wall),
		tint(
			new THREE.ConeGeometry(1.1, 2.8, 4)
				.rotateY(Math.PI / 4)
				.translate(0, 10.2, 3.2),
			c.roof,
		),
	]);
}

export function cow(c: PropColors) {
	const leg = (x: number, z: number) =>
		tint(box(0.28, 0.8, 0.28).translate(x, 0.4, z), c.cow);
	return merge([
		tint(box(1.1, 1.0, 2.1).translate(0, 1.25, 0), c.cow),
		tint(box(1.12, 0.6, 0.9).translate(0, 1.4, -0.3), c.cowPatch),
		tint(box(0.6, 0.6, 0.7).translate(0, 1.55, 1.25), c.cow),
		tint(box(0.34, 0.2, 0.2).translate(0, 1.1, 1.3), c.bell),
		leg(-0.35, -0.75),
		leg(0.35, -0.75),
		leg(-0.35, 0.75),
		leg(0.35, 0.75),
	]);
}

export function rock(c: PropColors) {
	const g = new THREE.DodecahedronGeometry(1.4, 0);
	g.scale(1.3, 0.7, 1);
	return merge([facets(g.translate(0, 0.35, 0), c.rock, c.rock, 0, 1)]);
}

// --- far models: each prop's outer-ring stand-in (#3076) ----------------------
// The same silhouette and colours in a fraction of the triangles, standing on
// the same ground: a building keeps its foundation's depth.

// A building far off: its foundation, walls and roof as one block and one prism.
function blockFar(
	w: number,
	d: number,
	walls: number,
	rise: number,
	overhang: number,
	c: PropColors,
	wall: string,
) {
	return [
		tint(box(w, walls + 3.1, d).translate(0, (walls - 3.1) / 2, 0), wall),
		tint(roof(w, d, rise, overhang).translate(0, walls, 0), c.roof),
	];
}

export const houseFar = (c: PropColors) =>
	merge(blockFar(9.2, 11.2, 6, 4.2, 1.4, c, c.wall));

export function churchFar(c: PropColors) {
	return merge([
		...blockFar(10, 18, 7, 5, 0.6, c, c.wall).map((g) => g.translate(0, 0, 2)),
		tint(box(4.6, 19.1, 4.6).translate(0, 6.45, -8.5), c.wall),
		tint(
			new THREE.ConeGeometry(3.4, 11, 4)
				.rotateY(Math.PI / 4)
				.translate(0, 21.5, -8.5),
			c.roof,
		),
	]);
}

export const barnFar = (c: PropColors) =>
	merge(blockFar(12, 18, 5, 5.5, 1.2, c, c.wood));
export const hutFar = (c: PropColors) =>
	merge(blockFar(7, 8, 4.2, 2.4, 1, c, c.wood));
export const cowFar = (c: PropColors) =>
	merge([tint(box(1.1, 1.75, 2.1).translate(0, 0.875, 0), c.cow)]);

// --- set-piece kits: small things that make a road a place -------------------

/** How far a street lamp's arm reaches out over the road from its post. */
export const LAMP_ARM = 1.6;

// A street lamp through a village: a grey post, an arm out over the road, a
// cap; the head under it is lampLit's.
export function lamp(c: PropColors) {
	return merge([
		tint(cyl(0.06, 0.08, 5, 6).translate(0, 2.5, 0), c.pole),
		tint(box(0.08, 0.08, LAMP_ARM).translate(0, 4.96, LAMP_ARM / 2), c.pole),
		tint(box(0.56, 0.12, 0.56).translate(0, 5, LAMP_ARM), c.pole),
	]);
}

export function bench(c: PropColors) {
	return merge([
		tint(box(1.8, 0.08, 0.45).translate(0, 0.45, 0), c.wood),
		tint(box(1.8, 0.4, 0.06).translate(0, 0.75, -0.22), c.wood),
		tint(box(0.08, 0.45, 0.4).translate(-0.8, 0.22, 0), c.trunk),
		tint(box(0.08, 0.45, 0.4).translate(0.8, 0.22, 0), c.trunk),
	]);
}

export function woodpile(c: PropColors) {
	const logs: THREE.BufferGeometry[] = [];
	for (let r = 0; r < 4; r++)
		for (let k = 0; k < 6 - r; k++)
			logs.push(
				tint(
					cyl(0.16, 0.16, 1.1, 6)
						.rotateX(Math.PI / 2)
						.translate((k - (5 - r) / 2) * 0.33, 0.16 + r * 0.29, 0),
					k % 2 ? c.wood : c.trunk,
				),
			);
	// Its cover lies on the top row, never floating over it.
	logs.push(tint(box(2.3, 0.08, 1.4).translate(0, 1.23, 0), c.roof));
	return merge(logs);
}

// Three round bales, each an eight-sided drum on one of its faces: the
// wrapped side in the bale's colour, the rolled ends lighter.
const BALE_R = 0.75;
const BALE_SIDES = 8;
export function bales(c: PropColors) {
	const rest = BALE_R * Math.cos(Math.PI / BALE_SIDES);
	const put = (g: THREE.BufferGeometry, x: number, z: number) =>
		g
			.rotateY(Math.PI / BALE_SIDES)
			.rotateZ(Math.PI / 2)
			.translate(x, rest, z);
	const bale = (x: number, z: number) => [
		facets(
			put(
				new THREE.CylinderGeometry(BALE_R, BALE_R, 1.2, BALE_SIDES, 1, true),
				x,
				z,
			),
			c.bale,
			c.bale,
			0,
			1,
		),
		...[-1, 1].map((end) =>
			tint(
				put(
					new THREE.CircleGeometry(BALE_R, BALE_SIDES)
						.rotateX((-end * Math.PI) / 2)
						.translate(0, end * 0.6, 0),
					x,
					z,
				),
				c.baleLight,
			),
		),
	];
	return merge([...bale(0, 0), ...bale(1.5, 0.6), ...bale(0.6, 1.9)]);
}

export function wayside(c: PropColors) {
	return merge([
		tint(box(0.7, 0.5, 0.5).translate(0, 0.25, 0), c.stone),
		tint(box(0.14, 2.4, 0.14).translate(0, 1.4, 0), c.wood),
		tint(box(1.0, 0.13, 0.14).translate(0, 2.0, 0), c.wood),
		tint(roof(0.8, 0.5, 0.35, 0.1).translate(0, 2.55, 0), c.roof),
	]);
}

// The yellow Swiss hiking signpost.
export function signpost(c: PropColors) {
	return merge([
		tint(cyl(0.05, 0.05, 2.6, 6).translate(0, 1.3, 0), c.pole),
		tint(box(0.9, 0.2, 0.04).translate(0.35, 2.3, 0), c.hiking),
		tint(box(0.9, 0.2, 0.04).rotateY(2.2).translate(-0.3, 2.0, 0.2), c.hiking),
		tint(box(0.3, 0.3, 0.04).translate(0, 2.6, 0.03), c.post),
	]);
}

export function fountain(c: PropColors) {
	return merge([
		tint(box(2.6, 0.7, 1.1).translate(0, 0.35, 0), c.stone),
		tint(box(2.3, 0.1, 0.8).translate(0, 0.66, 0), c.water),
		tint(box(0.3, 1.5, 0.3).translate(-1.4, 0.75, 0), c.stone),
		tint(
			cyl(0.03, 0.03, 0.5, 4)
				.rotateZ(Math.PI / 2)
				.translate(-1.05, 1.25, 0),
			c.pole,
		),
	]);
}

export function fence(c: PropColors) {
	const parts: THREE.BufferGeometry[] = [];
	for (let k = 0; k <= 5; k++)
		parts.push(tint(box(0.1, 1.1, 0.1).translate(k * 2 - 5, 0.55, 0), c.trunk));
	for (const y of [0.45, 0.9])
		parts.push(tint(box(10, 0.07, 0.05).translate(0, y, 0), c.wood));
	return merge(parts);
}

export function flagpole(c: PropColors, flag: string) {
	return merge([
		tint(cyl(0.05, 0.06, 8, 6).translate(0, 4, 0), c.pole),
		tint(box(1.6, 1.0, 0.02).translate(0.85, 7.3, 0), flag),
	]);
}

// Snow poles: 2.5 m, the rhythm that says you are high up.
export function snowpole(c: PropColors) {
	return merge([
		tint(cyl(0.04, 0.04, 2.5, 5).translate(0, 1.25, 0), c.snowpole, c.band),
	]);
}

// The Swiss delineator: white round post, black band, reflector.
export function delineator(c: PropColors) {
	return merge([
		tint(cyl(0.07, 0.07, 1.0, 8).translate(0, 0.5, 0), c.post),
		tint(cyl(0.075, 0.075, 0.2, 8).translate(0, 0.78, 0), c.band),
		tint(box(0.06, 0.12, 0.05).translate(0, 0.78, -0.07), c.reflector),
	]);
}

// --- Swiss road things a rider knows at a glance (#4240) ----------------------

/** A Swiss danger sign: a white triangle in a red border, point up, on a grey post, its picture in black. */
function dangerSign(c: PropColors, picture: THREE.BufferGeometry[]) {
	const face = (r: number, depth: number) =>
		cyl(r, r, depth, 3)
			.rotateX(-Math.PI / 2)
			.translate(0, 1.95, 0);
	return merge([
		tint(cyl(0.04, 0.04, 1.9, 6).translate(0, 0.95, 0), c.pole),
		tint(face(0.72, 0.03), c.warning),
		tint(face(0.54, 0.05), c.post),
		...picture.map((g) => tint(g, c.band)),
	]);
}

// Steep climb ahead: the slope as a black ramp.
export const steepSign = (c: PropColors) =>
	dangerSign(c, [
		box(0.6, 0.1, 0.07).rotateZ(0.42).translate(0, 1.86, 0),
		box(0.56, 0.09, 0.07).translate(0, 1.73, 0),
	]);

// Cattle on the road: the cow, side on.
export const cattleSign = (c: PropColors) =>
	dangerSign(c, [
		box(0.34, 0.14, 0.07).translate(0, 1.85, 0),
		box(0.1, 0.09, 0.07).translate(0.21, 1.9, 0),
		...[-0.13, -0.05, 0.06, 0.13].map((x) =>
			box(0.035, 0.13, 0.07).translate(x, 1.72, 0),
		),
	]);

// The convex mirror on a blind hairpin: an orange rim around bright glass.
export function mirror(c: PropColors) {
	const disc = (r: number, depth: number) =>
		cyl(r, r, depth, 16)
			.rotateX(Math.PI / 2)
			.translate(0, 2.35, 0.05);
	return merge([
		tint(cyl(0.05, 0.05, 2.4, 6).translate(0, 1.2, 0), c.pole),
		tint(disc(0.42, 0.05), c.snowpole),
		tint(disc(0.35, 0.08), c.reflector),
	]);
}

// The milk-can stand at the farm's road end: three cans on a wooden bench.
export function milkcans(c: PropColors) {
	const can = (x: number) => [
		tint(cyl(0.17, 0.19, 0.55, 8).translate(x, 0.82, 0), c.pole),
		tint(cyl(0.11, 0.11, 0.08, 8).translate(x, 1.13, 0), c.band),
	];
	return merge([
		tint(box(1.4, 0.08, 0.55).translate(0, 0.5, 0), c.wood),
		tint(box(0.1, 0.5, 0.5).translate(-0.6, 0.25, 0), c.trunk),
		tint(box(0.1, 0.5, 0.5).translate(0.6, 0.25, 0), c.trunk),
		...can(-0.42),
		...can(0),
		...can(0.42),
	]);
}

// The summit cross on a cairn, where the pass road tops out: steel, painted
// white, so it reads against the hut and the dusk alike.
export function summitCross(c: PropColors) {
	return merge([
		tint(cyl(0.6, 0.85, 0.6, 7).translate(0, 0.3, 0), c.stone),
		tint(box(0.18, 4.2, 0.18).translate(0, 2.6, 0), c.post),
		tint(box(1.5, 0.16, 0.16).translate(0, 3.6, 0), c.post),
	]);
}

// --- what lights after dusk (lights.ts): each model's lit parts, in their pane's colour ---

/** Windows a few cm proud of their walls: [w, h, x, y, z, turned to face +z by]. */
function windows(
	c: PropColors,
	list: [number, number, number, number, number, number][],
) {
	return merge(
		list.map(([w, h, x, y, z, a]) =>
			tint(new THREE.PlaneGeometry(w, h).rotateY(a).translate(x, y, z), c.band),
		),
	);
}
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

/** A house's lit windows: two downstairs on one side, one up on the other, two in the gable over one below. */
export const houseLit = (c: PropColors) =>
	windows(c, [
		[1, 1.1, 4.56, 1.8, -3.2, EAST],
		[1, 1.1, 4.56, 1.8, 3.2, EAST],
		[1, 1.1, -4.66, 4.4, 0, WEST],
		[1, 1.1, -2.2, 4.4, 5.66, 0],
		[1, 1.1, 2.2, 4.4, 5.66, 0],
		[1, 1.1, 2.2, 1.8, 5.56, 0],
	]);

/** A hut's: one in its side, one in its gable. */
export const hutLit = (c: PropColors) =>
	windows(c, [
		[0.8, 0.8, 3.36, 2.9, 1.2, EAST],
		[0.8, 0.8, 1.4, 2.9, 3.86, 0],
	]);

export const lampLit = (c: PropColors) =>
	merge([tint(box(0.44, 0.22, 0.44).translate(0, 4.83, LAMP_ARM), c.band)]);
