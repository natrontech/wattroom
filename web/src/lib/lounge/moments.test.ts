import { describe, expect, it } from 'vitest';
import {
	CAT_SLOT_SEC,
	CAT_SPOTS,
	FLYBY_SLOT_SEC,
	catAt,
	cuckooing,
	flybyAt,
	seasonOf,
} from '$lib/lounge/moments';

const DAY = 86_400;

describe('the lounge moments every screen shares', () => {
	it('puts the cat in the same place for the same crew and second', () => {
		for (let sec = 0; sec < DAY; sec += 37)
			expect(catAt(7, sec)).toEqual(catAt(7, sec));
	});

	it('rests the cat on one of its spots between walks', () => {
		const resting = catAt(7, 5 * CAT_SLOT_SEC + 60);
		expect(resting.pose).not.toBe('walk');
		expect(CAT_SPOTS).toContainEqual({ x: resting.x, y: resting.y });
	});

	it('moves the cat around over a day', () => {
		const places = new Set<number>();
		for (let slot = 0; slot < DAY / CAT_SLOT_SEC; slot++)
			places.add(catAt(7, slot * CAT_SLOT_SEC + 60).x);
		expect(places.size).toBe(CAT_SPOTS.length);
	});

	it('flies something past the window in some slots, and the same thing everywhere', () => {
		let seen = 0;
		for (let sec = 0; sec < DAY; sec += 2) {
			const now = flybyAt(42, sec);
			expect(now).toEqual(flybyAt(42, sec));
			if (now) {
				seen++;
				expect(now.f).toBeGreaterThanOrEqual(0);
				expect(now.f).toBeLessThanOrEqual(1);
			}
		}
		const slots = DAY / FLYBY_SLOT_SEC;
		// Each flyby lasts 9 to 45 s, in about six slots of ten.
		expect(seen).toBeGreaterThan(slots * 0.3 * (9 / 2));
		expect(seen).toBeLessThan(slots * 45);
	});

	it('gives two crews different windows', () => {
		const a: string[] = [];
		const b: string[] = [];
		for (let sec = 0; sec < DAY; sec += 5) {
			a.push(flybyAt(1, sec)?.kind ?? '');
			b.push(flybyAt(2, sec)?.kind ?? '');
		}
		expect(a).not.toEqual(b);
	});

	it('calls the cuckoo on the hour only', () => {
		expect(cuckooing(0, 0)).toBe(true);
		expect(cuckooing(0, 6)).toBe(false);
		expect(cuckooing(30, 0)).toBe(false);
	});

	it('dresses the room for Halloween week and December', () => {
		expect(seasonOf(new Date(2026, 9, 31))).toBe('halloween');
		expect(seasonOf(new Date(2026, 10, 2))).toBe('');
		expect(seasonOf(new Date(2026, 11, 24))).toBe('winter');
		expect(seasonOf(new Date(2026, 11, 27))).toBe('');
	});
});
