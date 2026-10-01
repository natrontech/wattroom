// Land use from the ground itself: what grows where, and how the light
// sits in the hollows. Pure functions of place, height and slope, shared by
// coarse and fine chunks so both agree along their seams. No water: the
// generator invents no lakes (#3075); real water is the map's (#3180).
import { Biome } from './biome';
import { CHUNK_M } from './place/lattice';
import { smoothstep } from './rand';
import type { Relief } from './terrain/ground';

export type Cover = { biome: Biome; forest: number };

// Forest where it is steep or north-facing (the farmer mows the flat sunny
// bits), never right beside a village road. `forest` is continuous so edges
// blend instead of printing camouflage.
export function landUse(noise: Relief) {
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
		const treeline = 1850 + 80 * noise('biome', [16 * CHUNK_M], x, z);
		if (d < 5) return bare(Biome.Verge);
		if (h > 2350) return bare(Biome.Snow);
		if (slope > 0.85) return bare(Biome.Rock);
		if (h > treeline) return bare(Biome.Alpine);
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
