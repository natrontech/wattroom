import type { Shape } from './synthetic';

/**
 * A made-up figure of eight, about 3.6 km: its two diagonals cross in the
 * middle. `rise` lifts the second diagonal over the first by that many
 * metres at the crossing: 0 is a level crossing, 8 a road over a road.
 */
export function eight(rise = 0): Shape {
	const low = 600;
	const high = low + rise;
	return {
		corners: [
			// It starts on a short side, so the crossing is nowhere near the start line.
			{ x: 1000, y: 600, ele: low, r: 80 },
			{ x: 1000, y: 0, ele: high, r: 80 },
			{ x: 0, y: 600, ele: high, r: 80 },
			{ x: 0, y: 0, ele: low, r: 80 },
		],
		seed: 4571,
	};
}
