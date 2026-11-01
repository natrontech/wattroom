import { describe, expect, it } from 'vitest';
import {
	SLOT_SEC,
	melodyNote,
	positionAt,
	sectionOf,
	tuneOf,
} from '$lib/lounge/station';

describe('house radio station', () => {
	it('gives every screen the same tune for a crew and slot', () => {
		expect(tuneOf('crew-a', 42)).toEqual(tuneOf('crew-a', 42));
	});

	it('gives two crews their own tunes', () => {
		const a = Array.from({ length: 6 }, (_, i) => tuneOf('crew-a', i).name);
		const b = Array.from({ length: 6 }, (_, i) => tuneOf('crew-b', i).name);
		expect(a).not.toEqual(b);
	});

	it('fits every tune inside its slot, with room for the gap', () => {
		for (let slot = 0; slot < 50; slot++) {
			const t = tuneOf('crew-a', slot);
			expect(t.bars * t.barSec).toBeLessThanOrEqual(SLOT_SEC - 2);
			expect(t.bpm).toBeGreaterThanOrEqual(64);
			expect(t.bpm).toBeLessThanOrEqual(92);
			for (const chord of t.chords)
				for (const n of chord.notes) {
					expect(n).toBeGreaterThanOrEqual(52);
					expect(n).toBeLessThanOrEqual(76);
				}
		}
	});

	it('runs intro, its own form and outro, then the gap', () => {
		const t = tuneOf('crew-a', 7);
		expect(sectionOf(t, 0)).toBe('intro');
		expect(sectionOf(t, 4)).toBe(t.form[0]);
		expect(sectionOf(t, 12)).toBe(t.form[1]);
		expect(sectionOf(t, 28)).toBe(t.form[3]);
		expect(sectionOf(t, t.bars - 1)).toBe('outro');
		expect(sectionOf(t, t.bars)).toBe('gap');
	});

	// Dave, 2026-11-01: "music is all the same with some little change only".
	// An evening is twenty-odd tunes; it should hear every instrument and both modes.
	it('changes its sound from tune to tune, not just its key', () => {
		const tunes = Array.from({ length: 24 }, (_, i) => tuneOf('crew-a', i));
		const kinds = (pick: (t: (typeof tunes)[number]) => unknown) =>
			new Set(tunes.map(pick)).size;
		expect(kinds((t) => t.mode)).toBe(2);
		expect(kinds((t) => t.keys)).toBeGreaterThanOrEqual(3);
		expect(kinds((t) => t.lead)).toBeGreaterThanOrEqual(3);
		expect(kinds((t) => t.kit)).toBeGreaterThanOrEqual(2);
		expect(kinds((t) => t.bassLine)).toBeGreaterThanOrEqual(2);
		expect(kinds((t) => t.form.join())).toBeGreaterThanOrEqual(3);
		expect(kinds((t) => t.bpm)).toBeGreaterThanOrEqual(6);
	});

	it('places a server time in its slot, bar and beat', () => {
		const slot = 11_000_000;
		const t = tuneOf('crew-a', slot);
		const p = positionAt('crew-a', slot * SLOT_SEC + t.barSec * 5 + 0.001);
		expect(p.tune).toEqual(t);
		expect(p.bar).toBe(5);
		expect(Math.floor(p.beat)).toBe(20);
		expect(p.section).toBe(t.form[0]);
	});

	it('keeps the melody in a singable range', () => {
		for (let slot = 0; slot < 50; slot++) {
			const t = tuneOf('crew-a', slot);
			for (let bar = 0; bar < 8; bar++)
				for (let e = 0; e < 8; e++) {
					const n = melodyNote(t, bar, e, true);
					if (n !== null) {
						expect(n).toBeGreaterThanOrEqual(48);
						expect(n).toBeLessThanOrEqual(81);
					}
				}
		}
	});
});
