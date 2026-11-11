import { describe, expect, it } from 'vitest';
import {
	PARTS,
	encodeLook,
	lookOf,
	seededLook,
	shuffledLook,
} from '#lib/lounge/look.ts';
import { fnv } from '#lib/world/loadout.ts';

describe('the lounge look', () => {
	it('keeps the look every rider wore before the editor', () => {
		for (const id of ['jan', 'kim', '09e8ff23-941e-4636-9926-abbed40c5ccf']) {
			const seed = fnv(id);
			expect(lookOf(id)).toMatchObject({
				skin: seed % 6,
				hairColour: (seed >>> 8) % 6,
				hair: (seed >>> 12) % 4,
			});
		}
	});

	it('reads back every look it writes', () => {
		let r = 1;
		const dice = () => (r = (r * 48271) % 2147483647) / 2147483647;
		for (let i = 0; i < 200; i++) {
			const look = shuffledLook(dice);
			expect(lookOf('jan', encodeLook(look))).toEqual(look);
		}
	});

	it('wears the seeded part wherever the string says nothing it knows', () => {
		const seeded = seededLook('jan');
		const parts = Object.keys(PARTS).length;
		// An older build's shorter string, a part past its choices, and junk.
		expect(lookOf('jan', '3')).toEqual({ ...seeded, skin: 3 });
		expect(lookOf('jan', 'z'.repeat(parts))).toEqual(seeded);
		expect(lookOf('jan', '!'.repeat(parts))).toEqual(seeded);
	});

	it('reads a string from before the newest parts', () => {
		const old = encodeLook({ ...seededLook('jan'), skin: 2 }).slice(0, 11);
		expect(lookOf('jan', old)).toEqual({ ...seededLook('jan'), skin: 2 });
	});

	it('fits the shape the server keeps', () => {
		const text = encodeLook(shuffledLook());
		expect(text).toMatch(/^[0-9a-z]{1,16}$/);
	});
});
