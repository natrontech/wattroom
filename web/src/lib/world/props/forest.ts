import { Biome } from '../biome';
import { noise2 } from '../rand';

/**
 * The forest's shape (#3675): trees stand in groups where a slow noise says
 * so, conifer stands line the road on open ground beside it, thinning
 * between groups but never opening, a meadow is a clearing between them and
 * a forest edge behind it, and the deep forest out of sight stands only in
 * its stands' hearts to pay for the near trees (docs/SPEC.md "The world":
 * dressing). On the placement path, so exact arithmetic only (place-lint).
 */

/** Metres across one group of trees. */
const STAND_M = 70;
/** The road's framing stands: from the shoulder's edge out, and how thick they grow. */
export const FRAME_NEAR = 12;
const FRAME_FAR = 40;
const FRAME_P = 0.32;
/** A framing stand thins in a gap between groups but never opens: the road is never bare for long. */
const FRAME_FLOOR = 0.6;
/** A clearing's forest edge: a belt behind the meadow beside the road, which hides what lies past it. */
const EDGE_FROM = 100;
const EDGE_FULL = 150;
const EDGE_END = 260;
const EDGE_GONE = 320;
const EDGE_P = 0.6;
/** The edge grows in stands, where the stand noise is above this (about a quarter of it). */
const EDGE_CUT = 0.4;
/** Within this of the road, a stand's heart grows a second tree beside each first. */
const PAIR_M = 120;
/** Past this the forest is out of the chase camera's sight: whole stands where the noise is above this (about 30 %), clearings between. */
const DEEP_M = 250;
const DEEP_CUT = 0.3;

const smooth = (a: number, b: number, t: number) => {
	const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
	return k * k * (3 - 2 * k);
};

/** The forest of one place, from a keyed seed; points are the key frame's metres east and north. */
export function forest(seed: number) {
	const stands = noise2(seed);
	return {
		/** The stand at a point: below 0 a gap, above it a group, its heart near 1. */
		groupAt: (e: number, n: number) => stands(e / STAND_M, n / STAND_M),
		/** Whether a tree here frames the road: on open ground beside it. */
		frames: (b: Biome, far: number) =>
			b !== Biome.Rock &&
			b !== Biome.Snow &&
			b !== Biome.Water &&
			far >= FRAME_NEAR &&
			far <= FRAME_FAR,
		/** The chance a cell holds a tree, `far` metres from the road in stand `g`. */
		chance(b: Biome, far: number, frame: boolean, g: number): number {
			const group = Math.min(2, Math.max(0, 1 + 1.4 * g));
			if (b === Biome.Forest)
				return far > DEEP_M ? (g > DEEP_CUT ? 0.78 : 0) : 0.78 * group;
			if (frame) return FRAME_P * Math.max(FRAME_FLOOR, group);
			if (b === Biome.Meadow)
				return g > EDGE_CUT
					? EDGE_P *
							smooth(EDGE_FROM, EDGE_FULL, far) *
							(1 - smooth(EDGE_END, EDGE_GONE, far))
					: 0;
			return b === Biome.Alpine ? 0.05 * group : 0;
		},
		/**
		 * How many trees grow close round one, from a keyed unit `u`: one
		 * framing the road or on a clearing's edge brings one to three, so none
		 * stands alone in the open; one in a stand's heart within sight, one.
		 */
		neighbours: (
			b: Biome,
			far: number,
			frame: boolean,
			g: number,
			u: number,
		) =>
			frame || (b === Biome.Meadow && far >= EDGE_FROM && far <= EDGE_GONE)
				? 1 + Math.floor(u * 3)
				: g >= 0.3 && far <= PAIR_M
					? 1
					: 0,
	};
}

/**
 * An offset `near` to `far` metres out, by the larger of its two axes, from
 * two keyed units: a square ring, so no trigonometry enters a decision.
 */
export function ringAt(
	a: number,
	b: number,
	near: number,
	far: number,
): [number, number] {
	const dx = (a - 0.5) * 2;
	const dz = (b - 0.5) * 2;
	const m = Math.max(Math.abs(dx), Math.abs(dz));
	if (m === 0) return [near, 0];
	const k = (near + (far - near) * m) / m;
	return [dx * k, dz * k];
}
