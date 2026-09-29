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
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];
