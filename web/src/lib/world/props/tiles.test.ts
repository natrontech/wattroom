import { describe, expect, it } from 'vitest';
import type { Placement } from '../placement/types';
import type { Prop } from './scatter';
import { standTiles } from './stand';
import { RANK, TILE_M, tileOf, type Candidate } from './tiles';

/**
 * A tile settles its candidates by rank against its own and its neighbours'
 * (#3699): what stands on either side of a tile's edge never depends on
 * which tile a ride asked for first.
 */

const tree = (x: number, z: number, rank: number): Candidate<Prop> => {
	const footprint: Placement['footprint'] = [
		[x - 3, z - 3],
		[x + 3, z - 3],
		[x + 3, z + 3],
		[x - 3, z + 3],
	];
	return {
		p: {
			id: `spruce@${x}:${z}`,
			kind: 'spruce',
			cls: 'kit',
			footprint,
			base: 0,
			height: 10,
		},
		rank,
		is: { kind: 'spruce', x, z, base: 0, turn: [1, 0], scale: 1 },
	};
};

/** Two trees whose crowns meet across the edge between tile (0, -1) and tile (1, -1), and one alone. */
const candidates = [
	tree(TILE_M - 2, 10, RANK.tree + 0.2),
	tree(TILE_M + 2, 10, RANK.tree + 0.7),
	tree(100, 100, RANK.tree + 0.1),
];

function world() {
	return standTiles(
		{
			tile: (ti, tj) =>
				candidates.filter((c) => {
					const [a, b] = tileOf(c.is.x, c.is.z);
					return a === ti && b === tj;
				}),
		},
		{ tile: () => [], boards: () => ({ signs: [], arches: [] }) },
	);
}

describe('a tile settled by rank (#3699)', () => {
	const [left, right] = [tileOf(TILE_M - 2, 10), tileOf(TILE_M + 2, 10)];

	it('puts the two trees in neighbouring tiles', () => {
		expect(right[0] - left[0]).toBe(1);
		expect(right[1]).toBe(left[1]);
	});

	it('stands the higher-ranked of two that touch across an edge, whichever tile came first', () => {
		const a = world();
		const b = world();
		const leftFirst = [a.tile(...left), a.tile(...right)];
		const rightFirst = [b.tile(...right), b.tile(...left)].reverse();
		expect(rightFirst).toEqual(leftFirst);
		const stood = leftFirst.flatMap((t) => t.props.map((p) => p.x));
		expect(stood).toContain(TILE_M + 2);
		expect(stood).not.toContain(TILE_M - 2);
		expect(stood).toContain(100);
	});
});
