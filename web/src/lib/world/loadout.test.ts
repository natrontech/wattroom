import { describe, expect, it } from 'vitest';
import { perceptualDistance } from '$lib/color';
import { MOST_ABREAST, formation } from './bunch';
import { bunchLooks, hexOf, JERSEY_BAND, seededLoadout } from './loadout';
import { prng } from './rand';

/** Account ids as the server mints them: UUIDs, here from a fixed seed. */
function ids(n: number, seed: number): string[] {
	const r = prng(seed);
	const hex = () => Math.floor(r() * 16).toString(16);
	return Array.from({ length: n }, () =>
		'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, hex),
	);
}
const jersey = (l: { colours?: Record<string, string> } | undefined) =>
	hexOf.get(l!.colours!.jerseyA)!;

describe('a bunch’s seeded kits (#3791)', () => {
	it('never seats two riders in one jersey band side by side, whatever their ids', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const order = ids(2 + (seed % 19), seed);
			const looks = bunchLooks(
				order.map((id) => ({ id })),
				MOST_ABREAST,
			);
			// Riders abreast share a row: the same metre ahead of the centre.
			const rows = new Map<number, string[]>();
			for (const [id, s] of formation(order, 0))
				rows.set(s.ahead, [...(rows.get(s.ahead) ?? []), id]);
			for (const row of rows.values())
				for (let i = 0; i < row.length; i++)
					for (let j = i + 1; j < row.length; j++)
						expect(
							perceptualDistance(
								jersey(looks.get(row[i])),
								jersey(looks.get(row[j])),
							),
							`${row[i]} beside ${row[j]}`,
						).toBeGreaterThan(JERSEY_BAND);
		}
	});

	it('dresses the first to join, and anyone riding alone, in their own seeded look', () => {
		for (const id of ids(50, 7))
			expect(bunchLooks([{ id }], MOST_ABREAST).get(id)).toEqual(
				seededLoadout(id),
			);
	});

	it('never changes the look of anyone who joined before a newcomer', () => {
		const order = ids(12, 11).map((id) => ({ id }));
		const before = bunchLooks(order.slice(0, 7), MOST_ABREAST);
		const after = bunchLooks(order, MOST_ABREAST);
		for (const [id, l] of before) expect(after.get(id)).toEqual(l);
	});

	it('keeps a chosen look as chosen', () => {
		const [a, b] = ids(2, 3);
		const chosen = {
			...seededLoadout(a),
			colours: { ...seededLoadout(a).colours, jerseyA: 'snow' },
		};
		const looks = bunchLooks(
			[{ id: a }, { id: b, look: chosen }],
			MOST_ABREAST,
		);
		expect(looks.get(b)).toBe(chosen);
	});
});
