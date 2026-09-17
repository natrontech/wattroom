import { describe, expect, it } from 'vitest';
import { shareAction } from './share';

/**
 * A control says what pressing it does (ux.md). The history row already did —
 * "Make private" / "Share" (#2004) — and the ride's own page said what the
 * ride IS, "Shared with friends" / "Private", with the same `aria-pressed`
 * under both. So on one of the two screens a rider pressed **Private** to make
 * a ride public (#2167).
 */
describe("the share toggle's words (#2167)", () => {
	it('names the act, never the state', () => {
		// A shared ride: the press makes it private.
		expect(shareAction(true).label).toBe('Make private');
		// A private one: the press shares it.
		expect(shareAction(false).label).toBe('Share with friends');
	});

	it('never labels a button with the state it is already in', () => {
		// The exact pair that made the ride page read backwards.
		expect(shareAction(true).label).not.toBe('Shared with friends');
		expect(shareAction(false).label).not.toBe('Private');
	});

	it('says both in the title: where the ride stands, and what happens', () => {
		expect(shareAction(true).title).toMatch(/Friends see this ride/);
		expect(shareAction(true).title).toMatch(/make it private/);
		expect(shareAction(false).title).toMatch(/Only you see this ride/);
		expect(shareAction(false).title).toMatch(/share it/);
	});
});
