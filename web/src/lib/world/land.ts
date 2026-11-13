// Land use from the ground itself: what grows where, and how the light
// sits in the hollows. Pure functions of place, height and slope, shared by
// coarse and fine chunks so both agree along their seams. No water: the
// generator invents no lakes (#3075); real water is the map's (#3180), and a
// designed road's is its scene's (designed.ts).
import { Biome } from './biome';
import { CHUNK_M } from './place/lattice';
import { smoothstep } from './rand';
import { EARTHWORKS_M, type Relief } from './terrain/ground';
import type { Scene } from './designed';

export type Cover = { biome: Biome; forest: number };

/** On a road's earthworks, steep ground is rock where the outcrop noise is above this (about a fifth of it). */
const OUTCROP_CUT = 0.35;

// Forest where it is steep or north-facing (the farmer mows the flat sunny
// bits), never right beside a village road. `forest` is continuous so edges
// blend instead of printing camouflage.
export function landUse(
	noise: Relief,
	/** A designed scene (designed.ts): its water, the ground it lays out by hand, and where its snow and trees stop. */
	scene?: Pick<Scene, 'waterAt' | 'coverAt' | 'climate'>,
) {
	const snowline = scene?.climate.snowline ?? 2350;
	const trees = scene?.climate.treeline ?? 1850;
	return (
		x: number,
		z: number,
		h: number,
		gx: number,
		gz: number,
		d: number,
	): Cover => {
		const slope = Math.sqrt(gx * gx + gz * gz);
		const bare = (biome: Biome): Cover => ({ biome, forest: 0 });
		// A bed, and the hand's width of shore the water laps.
		const level = scene?.waterAt(x, z) ?? null;
		if (level !== null && h < level + 0.1) return bare(Biome.Water);
		const treeline = trees + 80 * noise('biome', [16 * CHUNK_M], x, z);
		// A scene's own snowline wanders, as a snowfall's edge does; the generator's is a far summit's, and stays level.
		const snowy =
			h >
			snowline +
				(scene?.climate.snowline === undefined
					? 0
					: 30 * noise('biome', [2 * CHUNK_M], x, z));
		if (snowy && (h > treeline || d < 5)) return bare(Biome.Snow);
		// Snow under the trees: the forest stands in it, white, in stands with open snow between them, whichever way the slope faces.
		if (snowy && slope <= 0.85)
			return bare(
				noise('biome', [2 * CHUNK_M, CHUNK_M], x, z) > -0.12
					? Biome.Frost
					: Biome.Snow,
			);
		const laid = scene?.coverAt(x, z) ?? null;
		// A verge is mown grass; through a bog or over dry ground the road has none.
		if (d < 5 && laid === null) return bare(Biome.Verge);
		// A road's earthworks are grown over, rock only in outcrops: a cutting
		// painted rock whole was a bare wall beside the road (#3838).
		if (
			slope > 0.85 &&
			(d >= EARTHWORKS_M || noise('biome', [CHUNK_M / 4], x, z) > OUTCROP_CUT)
		)
			return bare(Biome.Rock);
		if (h > treeline) return bare(Biome.Alpine);
		if (laid !== null && !snowy) {
			// Tussocks of pale grass in the bog, and of green on the dry ground.
			const patch = noise('biome', [CHUNK_M / 2, CHUNK_M / 4], x, z);
			if (laid === 'moor')
				return bare(patch > 0.22 ? Biome.Alpine : Biome.Moor);
			return bare(patch > 0.3 ? Biome.Meadow : Biome.Dry);
		}
		const north = slope > 1e-4 ? gz / slope : 0;
		const f =
			0.2 +
			1.6 * (slope - 0.18) +
			0.25 * north * Math.min(1, slope * 5) +
			0.45 * noise('biome', [4 * CHUNK_M, 2 * CHUNK_M], x, z) -
			(h < 800 ? 0.12 : 0);

		return {
			biome: f > 0.5 ? Biome.Forest : Biome.Meadow,
			forest: smoothstep(0.4, 0.62, f),
		};
	};
}
export type LandUse = ReturnType<typeof landUse>;

// Fake ambient occlusion from curvature: hollows darker, crests lighter.
export function shadeOf(
	h: number,
	l: number,
	r: number,
	u: number,
	dn: number,
	step: number,
): number {
	const cav = (l + r + u + dn) / 4 - h;
	return Math.min(1.12, Math.max(0.72, 1 - cav / (step * 0.9)));
}
