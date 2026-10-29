// The trees (#4256): each kind in a few forms, a handful of flat faces each,
// so a stand mixes shapes. Proportions are chunky on purpose: they read at
// 30 m from a chase camera.
import * as THREE from 'three';
import { cyl, facets, merge, tint } from './model';
import type { PropColors } from './styles';

// A tree's trunk runs this far on below the ground, as a building's foundation
// does: its plinth, so a tree on a hillside stands on its uphill side and its
// root fills the downhill one (#3076). It covers the steepest forest land.ts
// grows (0.85) under the widest trunk (1 m at the largest scale, 1.45).
export const ROOT_M = 1.2;

// Every form of a kind stands on the same trunk, so the kind's footprint
// (kit.ts) is each form's: a form changes the crown, never where a tree may stand.
const spruceTrunk = (c: PropColors, seg = 5) =>
	tint(
		cyl(0.35, 0.5, 3 + ROOT_M, seg).translate(0, (3 - ROOT_M) / 2, 0),
		c.trunk,
	);
const leafTrunk = (c: PropColors, seg = 5) =>
	tint(
		cyl(0.3, 0.45, 4.5 + ROOT_M, seg).translate(0, (4.5 - ROOT_M) / 2, 0),
		c.trunk,
	);

/** A conifer's crown: cones of `[radius, height, middle]`, each tier turned off the one below. */
function conifer(
	c: PropColors,
	tiers: [number, number, number][],
	seg: number,
) {
	const lo = tiers[0][2] - tiers[0][1] / 2;
	const hi = Math.max(...tiers.map(([, h, y]) => y + h / 2));
	return tiers.map(([r, h, y], k) =>
		facets(
			new THREE.ConeGeometry(r, h, seg).rotateY(k * 0.5).translate(0, y, 0),
			c.spruce,
			c.spruceTip,
			lo,
			hi,
		),
	);
}

// A spruce: three stacked cones, 15 m.
export const spruce = (c: PropColors) =>
	merge([
		spruceTrunk(c),
		...conifer(
			c,
			[
				[4.2, 7, 5.5],
				[3.3, 6, 9],
				[2.2, 5, 12.4],
			],
			6,
		),
	]);

// A slender spruce: four narrow tiers, 17 m — the high forest's.
export const spruceSlender = (c: PropColors) =>
	merge([
		spruceTrunk(c),
		...conifer(
			c,
			[
				[3, 6, 4.6],
				[2.5, 5.5, 7.8],
				[1.9, 5, 10.8],
				[1.2, 5, 14.5],
			],
			6,
		),
	]);

// A fir: two broad tiers, 12.5 m — the valley's.
export const fir = (c: PropColors) =>
	merge([
		spruceTrunk(c),
		...conifer(
			c,
			[
				[4.8, 7.5, 5],
				[3.4, 6, 9.5],
			],
			7,
		),
	]);

/** A broadleaf crown: lumps of `[radius, x, y, z, stretch]`, each a twenty-faced ball. */
function crown(
	c: PropColors,
	lumps: [number, number, number, number, number][],
) {
	const lo = Math.min(...lumps.map(([r, , y, , k]) => y - r * k));
	const hi = Math.max(...lumps.map(([r, , y, , k]) => y + r * k));
	return lumps.map(([r, x, y, z, k]) =>
		facets(
			new THREE.IcosahedronGeometry(r, 0).scale(1, k, 1).translate(x, y, z),
			c.leaf,
			c.leafLight,
			lo,
			hi,
		),
	);
}

// A broadleaf: a trunk and three lumps.
export const broadleaf = (c: PropColors) =>
	merge([
		leafTrunk(c),
		...crown(c, [
			[3.6, 0, 6.6, 0, 0.85],
			[2.6, 1.6, 8.2, -0.8, 0.85],
			[2.2, -1.5, 7.8, 1, 0.85],
		]),
	]);

// A round broadleaf: one wide crown.
export const broadleafRound = (c: PropColors) =>
	merge([leafTrunk(c), ...crown(c, [[4.3, 0, 7.4, 0, 0.85]])]);

// A tall broadleaf, a poplar's oval: one narrow crown, 13 m.
export const broadleafTall = (c: PropColors) =>
	merge([leafTrunk(c), ...crown(c, [[2.6, 0, 8.3, 0, 1.8]])]);

// A tall broadleaf to stand beside a chapel — the landmark that reads against the sky.
export const linden = (c: PropColors) =>
	merge([
		tint(cyl(0.5, 0.8, 7, 7).translate(0, 3.5, 0), c.trunk),
		...crown(c, [
			[5.5, 0, 11, 0, 0.85],
			[4, 3, 13, -1.5, 0.85],
			[3.6, -2.6, 12.5, 1.8, 0.85],
		]),
	]);

// --- far trees: each form's outer-ring stand-in (#3076), standing on its root ---

// A conifer far off: its trunk and one cone over the crown's height.
const coniferFar = (c: PropColors, r: number, from: number, to: number) =>
	merge([
		spruceTrunk(c, 3),
		facets(
			new THREE.ConeGeometry(r, to - from, 5).translate(0, (from + to) / 2, 0),
			c.spruce,
			c.spruceTip,
			from,
			to,
		),
	]);
export const spruceFar = (c: PropColors) => coniferFar(c, 4.2, 2, 14.9);
export const spruceSlenderFar = (c: PropColors) => coniferFar(c, 3, 1.6, 17);
export const firFar = (c: PropColors) => coniferFar(c, 4.8, 1.25, 12.5);

// A broadleaf far off: its trunk and one lump.
const broadleafFarOf = (c: PropColors, r: number, y: number, k: number) =>
	merge([leafTrunk(c, 3), ...crown(c, [[r, 0, y, 0, k]])]);
export const broadleafFar = (c: PropColors) => broadleafFarOf(c, 4, 7.2, 0.85);
export const broadleafRoundFar = (c: PropColors) =>
	broadleafFarOf(c, 4.3, 7.4, 0.85);
export const broadleafTallFar = (c: PropColors) =>
	broadleafFarOf(c, 2.6, 8.3, 1.8);
