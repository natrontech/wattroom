// What the ground is, per terrain vertex. Its own module so a style's
// palette can name biomes without importing the world generator.
export const Biome = {
	Water: 0,
	Meadow: 1,
	Forest: 2,
	Alpine: 3,
	Rock: 4,
	Snow: 5,
	Verge: 6,
	/** A designed scene's own (designed.ts): a raised bog, a dry valley floor, and snow lying under trees. */
	Moor: 7,
	Dry: 8,
	Frost: 9,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];
