import { describe, expect, it } from 'vitest';
import {
	activeHref,
	activePlace,
	crewOfPath,
	crewPlaces,
	dmsCurrent,
	pages,
	roomPlaces,
} from './pages';

describe('activeHref', () => {
	it('lights up the destination a path belongs to', () => {
		expect(activeHref('/workouts')).toBe('/workouts');
		expect(activeHref('/workouts/edit')).toBe('/workouts');
		expect(activeHref('/history')).toBe('/history');
	});

	it('keeps Workouts lit under a ride and a ramp test (ADR-0020, rule 1)', () => {
		expect(activeHref('/ride')).toBe('/workouts');
		expect(activeHref('/ramp')).toBe('/workouts');
	});

	// ADR-0020's rule 1: a page not in the column has a parent row in it, lit
	// while you are there — and a page with no parent is a bug, not a page.
	// `/rooms` was retired INTO Home's "your rooms" section (it redirects to
	// /home#rooms) and the directory is that section's other half — the "No
	// code? Find a crew" line in the open/join card — so Home is that row.
	// Both used to leave the whole column dark (#1863).
	it('keeps Home lit on the crew directory and the retired /rooms stub', () => {
		expect(activeHref('/crews/directory')).toBe('/home');
		expect(activeHref('/rooms')).toBe('/home');
	});

	// The sidebar draws the messages tree's own rows — a thread's row for
	// /messages/dm/[peer], the room's own row for /messages/r/[slug] — so a
	// destination covering /messages would light a SECOND row beside them.
	// Exactly one row is current, which is why the heading carries the index.
	it('leaves the messages tree to the rows the sidebar draws for it', () => {
		expect(activeHref('/messages')).toBeUndefined();
		expect(activeHref('/messages/dm/rider-1')).toBeUndefined();
		expect(activeHref('/messages/r/velvet-hammer')).toBeUndefined();
	});

	it('has no entry for a path outside the three', () => {
		// A room lights its own entry in the rooms list, not a destination —
		// and /settings is the cog, which is a setting rather than a place.
		expect(activeHref('/r/velvet-hammer')).toBeUndefined();
		expect(activeHref('/settings')).toBeUndefined();
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

describe('dmsCurrent', () => {
	// The index never has a thread row of its own, on screen or otherwise.
	it('lights the heading on the messages index', () => {
		expect(dmsCurrent('/messages', true)).toBe(true);
		expect(dmsCurrent('/messages', false)).toBe(true);
	});

	// Exactly one row: the thread's own row is there and carries it.
	it('leaves the heading dark while the thread lights its own row', () => {
		expect(dmsCurrent('/messages/dm/rider-1', true)).toBe(false);
	});

	// The three ways the row is missing — a shut fold, a list that has not
	// landed, a conversation with no entry yet — are one question here, and
	// each of them used to leave the whole column dark (#1863).
	it('answers for a thread whose own row is not on screen', () => {
		expect(dmsCurrent('/messages/dm/rider-1', false)).toBe(true);
	});

	// A room's chat is not under this heading — the room's own row above is
	// its parent, and it is always drawn.
	it('leaves a room chat to the room row above it', () => {
		expect(dmsCurrent('/messages/r/velvet-hammer', false)).toBe(false);
		expect(dmsCurrent('/messages/r/velvet-hammer', true)).toBe(false);
	});

	it('says nothing off the messages tree', () => {
		expect(dmsCurrent('/home', false)).toBe(false);
		expect(dmsCurrent('/crews/directory', false)).toBe(false);
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

describe('roomPlaces', () => {
	// The room's Settings place went with the room's settings (#2454): the
	// crew's Settings keep its channels now, so every screen gets the same
	// list and a phone is offered nothing less.
	it('offers the room its places and no settings form', () => {
		expect(roomPlaces.map((p) => p.path)).toEqual([
			'/board',
			'',
			'/chat',
			'/training',
			'/sessions',
			'/members',
		]);
	});

	// The order is the feature (#2413): a notice on the fifth row is filed,
	// and one on the first is the door a rider comes through. Asserted here
	// because nothing else would notice the row drifting down the list.
	it('puts the Board first, above the Lounge', () => {
		expect(roomPlaces[0].path).toBe('/board');
	});
});

describe('a crew in the sidebar (#2447)', () => {
	it('lists its Home, Members and — for its admins on a desk — Settings', () => {
		const labels = (admin: boolean, narrow: boolean) =>
			crewPlaces('c1', admin, narrow).map((p) => p.label);
		expect(labels(true, false)).toEqual(['Home', 'Members', 'Settings']);
		expect(labels(false, false)).toEqual(['Home', 'Members']);
		// The 95% rule: nobody renames a crew from a bike.
		expect(labels(true, true)).toEqual(['Home', 'Members']);
	});

	it('knows which crew a path stands in', () => {
		expect(crewOfPath('/crew/c1')).toBe('c1');
		expect(crewOfPath('/crew/c1/v/v1/training')).toBe('c1');
		expect(crewOfPath('/crews/directory')).toBeUndefined();
		expect(crewOfPath('/home')).toBeUndefined();
	});
});
