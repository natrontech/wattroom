import { describe, expect, it } from 'vitest';
import { doorDisclosure } from './door';

describe('doorDisclosure (#1651)', () => {
	// ADR-0036: the board is "turned on ... visibly — what the room shares is
	// fixed and legible *before* anyone is inside it". Before means at the
	// door, because after the button the week is already published.
	it('says a board-enabled room keeps one, in the room settings own words', () => {
		const said = doorDisclosure({ boardEnabled: true }).board ?? '';
		expect(said).toMatch(/weekly board/);
		// What is published, not just that something is: SPEC's board carries
		// the week's kJ and time, bracketed by category, and resets Monday.
		expect(said).toMatch(/kJ/);
		expect(said).toMatch(/category/);
		expect(said).toMatch(/Monday/);
		// And the way out, which exists already — the door adds no second one.
		expect(said).toMatch(/take yourself off it/);
	});

	// The other half of the disclosure: a room with no board must not warn
	// about one. A door that says "there may be a board" everywhere teaches
	// riders to skip the line, which is how this became invisible in the
	// first place.
	it('says nothing about a board in a room that keeps none', () => {
		expect(doorDisclosure({ boardEnabled: false }).board).toBeUndefined();
		// Absent, not false: the server omits the field for a room with the
		// board off, and for a door that may not be told at all.
		expect(doorDisclosure({}).board).toBeUndefined();
	});

	// Whether the room ranks anyone or not, what it sees while you ride is the
	// same, and the door said that before this change (WATTROOM.md's locked
	// privacy rules). Adding the board line must not have cost it.
	it('keeps the standing privacy line either way', () => {
		for (const room of [{ boardEnabled: true }, { boardEnabled: false }]) {
			expect(doorDisclosure(room).privacy).toMatch(
				/visible to this room while you ride here, and nowhere else/,
			);
			expect(doorDisclosure(room).privacy).toMatch(/never recorded/);
		}
	});
});
