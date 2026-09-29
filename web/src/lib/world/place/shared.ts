/**
 * Same road, same world (#3226, ADR-0081): the predicates that decide
 * whether two worlds built from different routes agree where the routes share
 * a road. Pure functions over what a build produced, so the terrain, props
 * and set-piece builds (#3075–#3077) run them on their own worlds; #3226
 * proves them on a toy one. Coverage is the caller's to equalise: build both
 * worlds around one camera, or a level of detail hides a difference.
 */

/** One thing a world placed, where it was keyed: its frame, and metres in it to the centimetre. */
export type Thing = {
	kind: string;
	/** 'LV95', 'UTM32N', …; or 'region' for a private region's own frame. */
	frame: string;
	e: number;
	n: number;
	/** A sign's words. */
	text?: string;
	/** The physical frames of the spots that asked for its cell — two is a cell straddling a zone line. */
	spots?: readonly string[];
};

export type BuiltWorld = {
	/** Ground height, metres above the datum, at a point. */
	ground(lat: number, lon: number): number;
	things: readonly Thing[];
	/** Signs, with their words, and the set pieces that carry some. */
	signs: readonly Thing[];
	arch: Thing | null;
	/** Every name the world shows. */
	names: readonly string[];
	/** The panorama station its horizon comes from. */
	horizon: string;
};

/** The largest difference in ground height between two worlds over the samples. */
export function groundGap(
	a: BuiltWorld,
	b: BuiltWorld,
	samples: readonly (readonly [number, number])[],
): number {
	let worst = 0;
	for (const [lat, lon] of samples) {
		const d = a.ground(lat, lon) - b.ground(lat, lon);
		worst = Math.max(worst, d < 0 ? -d : d);
	}
	return worst;
}

const alike = (x: Thing, y: Thing, tol: number) =>
	x.kind === y.kind &&
	x.frame === y.frame &&
	x.text === y.text &&
	(x.e - y.e) * (x.e - y.e) + (x.n - y.n) * (x.n - y.n) <= tol * tol;

/** Things in either list with no partner in the other: the same kind, frame and words, within `tol` metres. */
export function unmatched(
	a: readonly Thing[],
	b: readonly Thing[],
	tol = 0.01,
): number {
	const lone = (xs: readonly Thing[], ys: readonly Thing[]) =>
		xs.filter((x) => !ys.some((y) => alike(x, y, tol))).length;
	return lone(a, b) + lone(b, a);
}

/** Things keyed in a cell that spots from two frames asked for: a cell across a zone line. */
export const straddling = (things: readonly Thing[]): number =>
	things.filter((t) => (t.spots?.length ?? 0) > 1).length;

/** The same arch, to the centimetre. */
export const sameArch = (a: BuiltWorld, b: BuiltWorld): boolean =>
	a.arch === null || b.arch === null
		? a.arch === b.arch
		: alike(a.arch, b.arch, 0.01);

/** The same names, in any order. */
export const sameNames = (a: BuiltWorld, b: BuiltWorld): boolean =>
	[...a.names].sort().join('\n') === [...b.names].sort().join('\n');

/** The same panorama station on the horizon. */
export const sameHorizon = (a: BuiltWorld, b: BuiltWorld): boolean =>
	a.horizon === b.horizon;
