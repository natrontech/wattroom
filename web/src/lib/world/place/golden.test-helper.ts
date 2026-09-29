import type { Road } from '$lib/road/road';
import type { Salt } from './keyed';
import { onStroke, type Keying } from './region';
import { strokeOf } from './stroke';

/**
 * One fixed world, for the pinned hash that Node (vitest) and every browser
 * and worker (e2e/world-place.spec.ts) must all reach. Made up: 6 km, a
 * steady climb, a pattern of turns, both ends hidden.
 */

export const GOLDEN_SALT: Salt = [
	0x9e3779b9, 0x7f4a7c15, 0x0badf00d, 0x2545f491,
];
const END_SALT: Salt = [11, 22, 33, 44];

export function goldenRoad(): Road {
	const n = 301;
	return {
		length: 6000,
		heights: Array.from({ length: n }, (_, i) => 500 + i * 0.4),
		turns: Array.from({ length: n - 1 }, (_, i) => ((i * 7) % 11) - 5),
	};
}

export function goldenKeying(): Keying {
	const road = goldenRoad();
	const stroke = strokeOf({ h: 'golden', road });
	return {
		stroke,
		salt: GOLDEN_SALT,
		regions: [
			onStroke(stroke, { fromM: 0, toM: 400, salt: END_SALT }),
			onStroke(stroke, {
				fromM: road.length - 400,
				toM: road.length,
				salt: END_SALT,
			}),
		],
	};
}

/** placementHash(goldenKeying(), 0, 6000, 40). */
export const GOLDEN_HASH = 'c97867bc';
