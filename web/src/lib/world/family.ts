import type { Object3D } from 'three';

/**
 * What a drawn object is, for the scene budget (#3083, docs/SPEC.md "The
 * world"): its draws and triangles count against its family's share and the
 * frame's. Everything drawn declares one where it is built; an object
 * without one fails the budget rather than slipping past it.
 */
export type Family =
	'sky' | 'terrain' | 'road' | 'dressing' | 'figures' | 'marks';

/** Declares `o`'s family, and what it is when that matters to the budget. */
export function tag<T extends Object3D>(
	family: Family,
	o: T,
	kind?: string,
): T {
	o.userData.family = family;
	if (kind) o.userData.kind = kind;
	return o;
}
