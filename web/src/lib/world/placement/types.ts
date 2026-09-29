import type { P2 } from './geom';

/**
 * The placement gates (#3219): what every generated object must satisfy
 * against the drawn roads and the drawn ground. Pure, DOM-free and
 * worker-safe; the terrain, props and set-piece builds (#3075–#3077) run
 * them on everything they place and assert zero violations.
 *
 * The numbers are #3219's (docs/SPEC.md proposals, defaults — tune in alpha).
 */
// prettier-ignore
export const GATES = {
	/** O1: metres from a road's drawn edge. */
	clear: { kit: 6.0, building: 8.0, furniture: [0.3, 1.6], overhead: 6.0, support: 1.0 },
	/** O2: a base may stand this far above the drawn ground, beyond its plinth. */
	float: 0.03,
	/** O3: how deep a base may sink. */
	bury: { kitShare: 0.25, kitMax: 0.3, building: 0.6 },
	/** O4: vertical within 0.999; signs face travel within 35°; arches square to it within 3°. */
	upright: 0.999, signDeg: 35, archDeg: 3,
	/** O5: undeclared overlap beyond 0.01 m², and two of a kind nearer than 0.25 m. */
	overlapM2: 0.01, sameKindM: 0.25,
} as const;

export type Road = {
	/** The drawn centreline, x and z. */
	points: readonly P2[];
	halfWidth: number;
	/** How far the drawn edge sags on the inside of a bend. */
	sag?: number;
};
export type Ground = (x: number, z: number) => number;
export type Class = 'kit' | 'building' | 'furniture' | 'overhead';

export type Placement = {
	id: string;
	kind: string;
	cls: Class;
	/** Convex, in x and z. */
	footprint: readonly P2[];
	/** The base's height, world metres. */
	base: number;
	height: number;
	/** How much of the kit is plinth, made to sit in the ground. */
	plinth?: number;
	/** Posts and stilt feet, each checked on its own. */
	feet?: readonly P2[];
	/** An overhead object's legs, and the height of its underside. */
	supports?: readonly (readonly P2[])[];
	underside?: number;
	/** The object's up axis, for anything meant to stand vertical. */
	up?: readonly [number, number, number];
	/** A sign's face, and the direction of the traffic it stands for. */
	facing?: P2;
	travel?: P2;
	/** An arch's span. */
	across?: P2;
	hillside?: boolean;
	/** A declared exception to O3: an erratic, sunk on purpose. */
	sunk?: boolean;
	/** Kinds this one may overlap. */
	mayOverlap?: readonly string[];
};

export type Rule = 'O1' | 'O2' | 'O3' | 'O4' | 'O5';
export type Violation = {
	rule: Rule;
	id: string;
	kind: string;
	by: number;
	why: string;
};
