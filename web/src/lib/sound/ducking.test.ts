import { describe, expect, it } from 'vitest';
import { shouldDuck } from '$lib/sound/ducking';

const ME = 'rider-me';
const THEM = 'rider-them';

describe('shouldDuck (#867)', () => {
	it('dips under another rider, whichever way the switch is set', () => {
		const speaking = { [THEM]: true };
		expect(shouldDuck(speaking, ME, false)).toBe(true);
		expect(shouldDuck(speaking, ME, true)).toBe(true);
	});

	it('ignores your own voice by default — the room does not dip under you', () => {
		expect(shouldDuck({ [ME]: true }, ME, false)).toBe(false);
	});

	it('dips under your own voice once you ask it to', () => {
		expect(shouldDuck({ [ME]: true }, ME, true)).toBe(true);
	});

	it('still dips when someone else speaks over you', () => {
		expect(shouldDuck({ [ME]: true, [THEM]: true }, ME, false)).toBe(true);
	});

	it('stays up in a silent room, and under a rider who stopped', () => {
		expect(shouldDuck({}, ME, true)).toBe(false);
		expect(shouldDuck({ [THEM]: false, [ME]: undefined }, ME, true)).toBe(
			false,
		);
	});

	it('ducks under every voice when it does not know who you are', () => {
		// Mock surfaces and the moment before /api/me answers: dipping under a
		// voice you might own is better than talking over one you do not.
		expect(shouldDuck({ [ME]: true }, undefined, false)).toBe(true);
	});
});
