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
const spruceTrunk = (c: PropColors) =>
	tint(
		cyl(0.35, 0.5, 3 + ROOT_M, 5).translate(0, (3 - ROOT_M) / 2, 0),
		c.trunk,
	);
const leafTrunk = (c: PropColors) =>
	tint(
		cyl(0.3, 0.45, 4.5 + ROOT_M, 5).translate(0, (4.5 - ROOT_M) / 2, 0),
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

// Every conifer's lowest tier starts 2 m up, as the spruce's does, so on the
// steepest forest it still clears the ground uphill of its trunk.

// A slender spruce: four narrow tiers, 17 m — the high forest's.
export const spruceSlender = (c: PropColors) =>
	merge([
		spruceTrunk(c),
		...conifer(
			c,
			[
				[3, 6, 5],
				[2.5, 5.5, 8.2],
				[1.9, 5, 11.2],
				[1.2, 5, 14.9],
			],
			6,
		),
	]);

// A fir: two broad tiers, 13 m — the valley's.
export const fir = (c: PropColors) =>
	merge([
		spruceTrunk(c),
		...conifer(
			c,
			[
				[4.6, 7.5, 5.75],
				[3.3, 6, 10.25],
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

// --- far trees: each form's outer-ring stand-in (#3076) ------------------------
// Its crown runs down into its root, with no trunk: past the near ring a
// trunk is thinner than a pixel (ADR-0092), and a crown covers the ground a
// trunk's root would on a slope.

// A conifer far off: one cone, as wide at `from` as the near crown's foot, down to the root.
const coniferFar = (c: PropColors, r: number, from: number, to: number) =>
	merge([
		facets(
			new THREE.ConeGeometry(
				(r * (to + ROOT_M)) / (to - from),
				to + ROOT_M,
				5,
			).translate(0, (to - ROOT_M) / 2, 0),
			c.spruce,
			c.spruceTip,
			from,
			to,
		),
	]);
export const spruceFar = (c: PropColors) => coniferFar(c, 4.2, 2, 14.9);
export const spruceSlenderFar = (c: PropColors) => coniferFar(c, 3, 2, 17.4);
export const firFar = (c: PropColors) => coniferFar(c, 4.6, 2, 13.25);

// A broadleaf far off: one lump from its root to the near crown's top.
const broadleafFarOf = (c: PropColors, r: number, top: number) =>
	merge(crown(c, [[r, 0, (top - ROOT_M) / 2, 0, (top + ROOT_M) / (2 * r)]]));
export const broadleafFar = (c: PropColors) => broadleafFarOf(c, 4, 10.6);
export const broadleafRoundFar = (c: PropColors) =>
	broadleafFarOf(c, 4.3, 11.1);
export const broadleafTallFar = (c: PropColors) => broadleafFarOf(c, 2.6, 13);
