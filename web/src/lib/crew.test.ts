import { describe, expect, it } from 'vitest';
import { crewDoorDisclosure } from './crew';

describe('crewDoorDisclosure (#2456)', () => {
	// ADR-0036: a board is on "visibly", before anyone is inside — at the
	// door, because after the button the week is already published.
	it('says a crew with a board keeps one, and what it ranks', () => {
		const said = crewDoorDisclosure({ boardEnabled: true });
		expect(said.board).toMatch(/weekly board/);
		expect(said.board).toMatch(/kJ/);
		expect(said.board).toMatch(/category/);
		expect(said.board).toMatch(/Monday/);
		expect(said.board).toMatch(/take yourself off it/);
		// The board publishes numbers, so the door must not say it does not.
		expect(said.privacy).not.toMatch(/shows nobody your numbers/);
	});

	// A door that warns of a board everywhere teaches riders to skip the line.
	it('says nothing of a board a crew does not keep', () => {
		for (const door of [{ boardEnabled: false }, {}]) {
			const said = crewDoorDisclosure(door);
			expect(said.board).toBeUndefined();
			expect(said.privacy).toMatch(/shows nobody your numbers/);
		}
	});

	it('keeps the standing privacy line either way', () => {
		for (const door of [{ boardEnabled: true }, { boardEnabled: false }]) {
			expect(crewDoorDisclosure(door).privacy).toMatch(
				/visible to the session you ride in, while you ride, and nowhere else/,
			);
		}
	});
});
