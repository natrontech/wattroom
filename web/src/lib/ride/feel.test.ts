import { describe, expect, it } from 'vitest';
import { MaxRideNoteChars, MaxRPE, MinRPE } from '$lib/protocol';
import { RPE_SCALE, noteTooLong, rpeLabel, rpeText } from './feel';

/**
 * docs/SPEC.md "How a ride felt" fixes the scale; this is the picker reading
 * it rather than a second copy of it. The bounds come through the generated
 * protocol, so a widened scale moves the buttons without an edit here.
 */
describe('the RPE scale (#2328)', () => {
	it('is the protocol bounds, whole, in order', () => {
		expect(RPE_SCALE[0]).toBe(MinRPE);
		expect(RPE_SCALE.at(-1)).toBe(MaxRPE);
		expect(RPE_SCALE).toHaveLength(MaxRPE - MinRPE + 1);
		expect(RPE_SCALE).toStrictEqual([...RPE_SCALE].sort((a, b) => a - b));
	});

	// CR10's zero is "rest", and a saved ride is at least a minute of
	// pedalling. A button for it would offer a rating the server refuses.
	it('offers no zero', () => {
		expect(RPE_SCALE).not.toContain(0);
	});

	it('uses the published anchors verbatim', () => {
		expect(rpeLabel(1)).toBe('very easy');
		expect(rpeLabel(3)).toBe('moderate');
		expect(rpeLabel(5)).toBe('hard');
		expect(rpeLabel(7)).toBe('very hard');
		expect(rpeLabel(10)).toBe('maximal');
	});

	// 6, 8 and 9 carry no word in the CR10, and docs/SPEC.md says so: a
	// word for them — even "harder than hard" — is not the scale any more
	// (#2634). They read as their number out of ten.
	it('gives an unanchored step no word', () => {
		expect(rpeLabel(6)).toBe('');
		expect(rpeLabel(8)).toBe('');
		expect(rpeLabel(9)).toBe('');
	});

	it('writes an anchor with its word and a step as its number', () => {
		expect(rpeText(7)).toBe('7 — very hard');
		expect(rpeText(6)).toBe('6 of 10');
		expect(rpeText(9)).toBe('9 of 10');
	});
});

describe("the note's bound (#2328)", () => {
	it('is counted in characters, not bytes', () => {
		// The exact bound in three-byte runes: legal, and a byte count would
		// refuse it at three times the number (#1986).
		expect(noteTooLong('あ'.repeat(MaxRideNoteChars))).toBe(false);
		expect(noteTooLong('あ'.repeat(MaxRideNoteChars + 1))).toBe(true);
	});

	it('measures what would be stored, not what was typed', () => {
		// The server trims before it counts, so trailing whitespace must not
		// make the box red while the save would have gone through.
		expect(noteTooLong(`  ${'x'.repeat(MaxRideNoteChars)}  `)).toBe(false);
	});
});
