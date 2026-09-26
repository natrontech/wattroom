// Land use from the ground itself: what grows where, and how the light
// sits in the hollows. Pure functions of height and slope, shared by the
// coarse grid and the fine chunks so both agree along their seams.
import { Biome } from './biome';
import { fbm, smoothstep, type Noise2 } from './rand';

export type Cover = { biome: Biome; forest: number };

// Forest where it is steep or north-facing (the farmer mows the flat sunny
// bits), never right beside a village road. `forest` is continuous so edges
// blend instead of printing camouflage.
export function landUse(detail: Noise2, water: number) {
	const treeline = 1850 + 80 * fbm(detail, 3.1, 7.7, 1);
	return (
		x: number,
		z: number,
		h: number,
		gx: number,
		gz: number,
		d: number,
	): Cover => {
		const slope = Math.hypot(gx, gz);
		const bare = (biome: Biome): Cover => ({ biome, forest: 0 });
		if (!Number.isNaN(water) && h < water + 0.5 && d > 25)
			return bare(Biome.Water);
		if (d < 5) return bare(Biome.Verge);
		if (h > 2350) return bare(Biome.Snow);
		if (slope > 0.85) return bare(Biome.Rock);
		if (h > treeline) return bare(Biome.Alpine);
		const north = slope > 1e-4 ? gz / slope : 0;
		const f =
			0.2 +
			1.6 * (slope - 0.18) +
			0.25 * north * Math.min(1, slope * 5) +
			0.45 * fbm(detail, x / 420, z / 420, 2) -
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
