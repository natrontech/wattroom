import { describe, expect, it } from 'vitest';
import { activeHref, pages } from './pages';

describe('activeHref', () => {
	it('lights up the entry a path belongs to', () => {
		expect(activeHref('/workouts')).toBe('/workouts');
		expect(activeHref('/workouts/edit')).toBe('/workouts');
		expect(activeHref('/profile')).toBe('/profile');
	});

	// Rooms owns three prefixes: itself, a room page, and the planning
	// surface. Sessions is not a ninth destination in the bar.
	it('gives Rooms the room and session paths', () => {
		expect(activeHref('/rooms')).toBe('/rooms');
		expect(activeHref('/r/velvet-hammer')).toBe('/rooms');
		expect(activeHref('/sessions')).toBe('/rooms');
	});

	it('has no entry for an unknown path', () => {
		expect(activeHref('/nowhere')).toBeUndefined();
	});

	it('keeps a Sessions entry out of the bar', () => {
		expect(pages.some((p) => p.href === '/sessions')).toBe(false);
	});
});
