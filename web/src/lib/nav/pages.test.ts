import { describe, expect, it } from 'vitest';
import { activeHref, activePlace, pages, roomPlaces } from './pages';

describe('activeHref', () => {
	it('lights up the destination a path belongs to', () => {
		expect(activeHref('/workouts')).toBe('/workouts');
		expect(activeHref('/workouts/edit')).toBe('/workouts');
		expect(activeHref('/history')).toBe('/history');
	});

	it('has no entry for a path outside the three', () => {
		// A room lights its own entry in the rooms list, not a destination —
		// and /profile is the cog, which is a setting rather than a place.
		expect(activeHref('/r/velvet-hammer')).toBeUndefined();
		expect(activeHref('/profile')).toBeUndefined();
		expect(activeHref('/nowhere')).toBeUndefined();
	});

	// ADR-0020 retired five destinations into the pages they belonged to.
	it('keeps the retired destinations out of the sidebar', () => {
		for (const gone of [
			'/rooms',
			'/sessions',
			'/progression',
			'/ramp',
			'/pair',
		])
			expect(pages.some((p) => p.href === gone)).toBe(false);
	});
});

describe('activePlace', () => {
	it('resolves the lounge from the room root', () => {
		expect(activePlace('/r/velvet-hammer', 'velvet-hammer')).toBe('');
	});

	// The lounge's path is '', so a naive startsWith matches everything —
	// longest match is what keeps /training off the lounge.
	it('does not let the lounge swallow the other places', () => {
		for (const place of roomPlaces.filter((p) => p.path))
			expect(
				activePlace(`/r/velvet-hammer${place.path}`, 'velvet-hammer'),
			).toBe(place.path);
	});

	it('ignores a slug that looks like a place', () => {
		expect(activePlace('/r/training', 'training')).toBe('');
	});
});
