/**
 * The figure's contract (#3070): the bones a pose writes and the colour
 * slots a palette paints. model.js's 18 bones keep their order and meaning,
 * so every index a caller already uses still holds; fork and hands follow.
 */

// prettier-ignore
export const BONES = [
	'root', 'bike', 'frontWheel', 'rearWheel', 'crank', 'pelvis', 'torso', 'head',
	'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'armL', 'foreL', 'armR', 'foreR',
	'fork', 'handL', 'handR',
] as const;
export type BoneName = (typeof BONES)[number];
export const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<
	BoneName,
	number
>;

// prettier-ignore
export const SLOTS = [
	'jersey', 'jerseyAccent', 'helmet', 'skin', 'shorts', 'shoe', 'frame', 'tyre', 'rim', 'metal', 'glasses',
	'frameAccent', 'sock', 'glove', 'helmetAccent', 'lens', 'saddle', 'barTape', 'groupset', 'bottle', 'sole',
	'spokes', 'hair', 'shortsAccent', 'tyreWall', 'bottleCap', 'hood', 'chain', 'sockAccent', 'leather',
] as const;
export type SlotName = (typeof SLOTS)[number];
export const S = Object.fromEntries(SLOTS.map((n, i) => [n, i])) as Record<
	SlotName,
	number
>;

/** Pattern spaces (the aux attribute's x): which rule the material paints a vertex by. */
export const SP = {
	none: 0,
	torso: 1,
	sleeve: 2,
	decal: 3,
	spokes: 4,
	blades: 5,
};

export type Aux = readonly [number, number, number];
export const A0: Aux = [0, 0, 0];
