import { describe, expect, it } from 'vitest';
import {
	SET_SLOTS,
	SLOT_SEC,
	barNotes,
	positionAt,
	sectionOf,
	styleOf,
	tuneOf,
} from '$lib/lounge/station';

/** A bar as what sounds and where, without the hands' velocity and timing. */
const shape = (crew: string, slot: number, bar: number) =>
	barNotes(tuneOf(crew, slot), bar)
		.map((n) => `${n.part}${n.midi}@${n.s}`)
		.sort()
		.join(' ');

describe('house radio station', () => {
	it('gives every screen the same tune for a crew and slot', () => {
		expect(tuneOf('crew-a', 42)).toEqual(tuneOf('crew-a', 42));
	});

	it('plays the same notes for the same crew and clock', () => {
		const slot = 11_000_000;
		const before = barNotes(tuneOf('crew-a', slot), 17);
		// Another screen that has played other tunes since: a cold cache.
		for (let i = 1; i < 20; i++) tuneOf('crew-a', slot + i);
		expect(barNotes(tuneOf('crew-a', slot), 17)).toEqual(before);
		expect(barNotes(tuneOf('crew-b', slot), 17)).not.toEqual(before);
	});

	// Jan, 2026-11-02: "too repetitive". Half an hour is twelve tunes; no
	// stretch of eight bars in it may come round again note for note.
	it('never repeats eight bars note for note inside half an hour', () => {
		for (const crew of ['crew-a', 'crew-b', 'crew-c']) {
			const bars: string[] = [];
			for (let slot = 11_000_000; slot < 11_000_012; slot++)
				for (let bar = 0; bar < tuneOf(crew, slot).bars; bar++)
					bars.push(shape(crew, slot, bar));
			const windows = bars
				.slice(7)
				.map((_, i) => bars.slice(i, i + 8).join('|'));
			expect(new Set(windows).size).toBe(windows.length);
		}
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
			expect(t.bpm).toBeGreaterThanOrEqual(60);
			expect(t.bpm).toBeLessThanOrEqual(92);
			for (const chord of [...t.chords, ...t.bridge])
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
		expect(barNotes(t, t.bars)).toEqual([]);
	});

	// Dave, 2026-11-01: "music is all the same with some little change only".
	it('changes its sound from tune to tune, not just its key', () => {
		const tunes = Array.from({ length: 48 }, (_, i) => tuneOf('crew-a', i));
		const kinds = (pick: (t: (typeof tunes)[number]) => unknown) =>
			new Set(tunes.map(pick)).size;
		expect(kinds((t) => t.mode)).toBe(2);
		expect(kinds((t) => t.style)).toBe(3);
		expect(kinds((t) => t.keys)).toBeGreaterThanOrEqual(4);
		expect(kinds((t) => t.lead)).toBeGreaterThanOrEqual(4);
		expect(kinds((t) => t.kit)).toBeGreaterThanOrEqual(3);
		expect(kinds((t) => t.form.join())).toBeGreaterThanOrEqual(3);
		expect(kinds((t) => t.bpm)).toBeGreaterThanOrEqual(8);
	});

	it('keeps a style for a set of tunes, and mostly plays lofi', () => {
		const day = Array.from(
			{ length: 576 },
			(_, i) => tuneOf('crew-a', i).style,
		);
		for (let i = 0; i < day.length; i++)
			expect(day[i]).toBe(day[i - (i % SET_SLOTS)]);
		const lofi = day.filter((s) => s === 'lofi').length;
		expect(lofi / day.length).toBeGreaterThan(0.4);
	});

	it('leaves the drums out of ambient', () => {
		for (let slot = 0; slot < 200; slot++) {
			const t = tuneOf('crew-a', slot);
			if (t.style !== 'ambient') continue;
			for (let bar = 0; bar < t.bars; bar++)
				for (const n of barNotes(t, bar))
					expect(['kick', 'snare', 'hat', 'open']).not.toContain(n.part);
		}
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
			for (let bar = 0; bar < t.bars; bar++)
				for (const n of barNotes(t, bar)) {
					if (n.part !== 'lead') continue;
					expect(n.midi).toBeGreaterThanOrEqual(48);
					expect(n.midi).toBeLessThanOrEqual(81);
				}
		}
	});

	it('plays the style the channel picked instead of the mix, alike on every screen', () => {
		for (let slot = 0; slot < 40; slot++) {
			expect(styleOf('crew-a', slot, 'chip')).toBe('chip');
			expect(tuneOf('crew-a', slot, 'ambient').style).toBe('ambient');
			expect(tuneOf('crew-a', slot, 'lofi')).toEqual(
				tuneOf('crew-a', slot, 'lofi'),
			);
		}
		const mix = Array.from({ length: 40 }, (_, slot) =>
			styleOf('crew-a', slot),
		);
		expect(new Set(mix).size).toBeGreaterThan(1);
		expect(tuneOf('crew-a', 3, '')).toEqual(tuneOf('crew-a', 3));
	});
});
