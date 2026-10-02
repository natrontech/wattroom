import { Biome } from '../biome';
import { noise2 } from '../rand';

/**
 * The forest's shape (#3675): trees stand in groups where a slow noise says
 * so, conifer stands come down to the road on long stretches of it, a
 * meadow is a clearing with a forest edge behind it, and the deep forest out
 * of sight thins to pay for the near trees (docs/SPEC.md "The world":
 * dressing). On the placement path, so exact arithmetic only (place-lint).
 */

/** Metres across one group of trees, and one stretch of road the forest frames. */
const STAND_M = 70;
const FRAME_M = 260;
/** The road's framing stands: from the shoulder's edge out, and how much of the road has them. */
export const FRAME_NEAR = 12;
const FRAME_FAR = 40;
const FRAME_ABOVE = -0.25;
const FRAME_P = 0.62;
/** A clearing's forest edge: a belt behind the meadow beside the road, which hides what lies past it. */
const EDGE_FROM = 100;
const EDGE_FULL = 150;
const EDGE_END = 260;
const EDGE_GONE = 320;
const EDGE_P = 0.38;
/** Within this of the road, a stand's heart grows a second tree beside each first. */
export const PAIR_M = 120;
/** Past this the forest is out of the chase camera's sight, and thins to this share. */
const DEEP_M = 250;
const DEEP_THIN = 0.35;

const smooth = (a: number, b: number, t: number) => {
	const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
	return k * k * (3 - 2 * k);
};

/** The forest of one place, from two keyed seeds; points are the key frame's metres east and north. */
export function forest([standSeed, frameSeed]: [number, number]) {
	const stands = noise2(standSeed);
	const frames = noise2(frameSeed);
	return {
		/** The stand at a point: below 0 a gap, above it a group, its heart near 1. */
		groupAt: (e: number, n: number) => stands(e / STAND_M, n / STAND_M),
		/** Whether a tree here frames the road: on open ground beside it, on long stretches of it. */
		frames: (b: Biome, far: number, e: number, n: number) =>
			b !== Biome.Rock &&
			b !== Biome.Snow &&
			b !== Biome.Water &&
			far >= FRAME_NEAR &&
			far <= FRAME_FAR &&
			frames(e / FRAME_M, n / FRAME_M) > FRAME_ABOVE,
		/** The chance a cell holds a tree, `far` metres from the road in stand `g`. */
		chance(b: Biome, far: number, frame: boolean, g: number): number {
			const group = Math.min(2, Math.max(0, 1 + 1.4 * g));
			const p =
				b === Biome.Forest
					? 0.78 * (far > DEEP_M ? DEEP_THIN : 1)
					: frame
						? FRAME_P
						: b === Biome.Meadow
							? Math.max(
									0.018,
									EDGE_P *
										smooth(EDGE_FROM, EDGE_FULL, far) *
										(1 - smooth(EDGE_END, EDGE_GONE, far)),
								)
							: b === Biome.Alpine
								? 0.05
								: 0;
			return p * group;
		},
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
