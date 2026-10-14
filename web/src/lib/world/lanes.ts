// How wide a bunch rides (#3098), apart from three.js so a route can dress
// a bunch (#3791) without pulling the world into its chunk.

/** docs/SPEC.md "Drafting": 3, 4 or 5 lanes for up to 6, 12 or more riders. */
export function lanesFor(n: number): number {
	return n <= 6 ? 3 : n <= 12 ? 4 : 5;
}
/** The most riders a row seats side by side, however big the bunch. */
export const MOST_ABREAST = lanesFor(Infinity);
