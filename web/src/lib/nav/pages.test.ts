import { describe, expect, it } from 'vitest';
import {
	activeHref,
	columnCrew,
	crewOfPath,
	crewPlaces,
	dmsCurrent,
	pages,
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
	// `/rooms` is a stub that redirects to the crew directory (#2458), and the
	// directory is Home's other half — the "No code? Find a crew" line in the
	// open/join card — so Home is that row.
	// Both used to leave the whole column dark (#1863).
	it('keeps Home lit on the crew directory and the retired /rooms stub', () => {
		expect(activeHref('/crews/directory')).toBe('/home');
		expect(activeHref('/rooms')).toBe('/home');
		// Your rider page is Home's level tile opened; the name card that lit
		// for it goes to You now (#2581).
		expect(activeHref('/u/me')).toBe('/home');
	});

	// The sidebar draws the messages tree's own rows — a thread's row for
	// /messages/dm/[peer] — so a destination covering /messages would light a
	// SECOND row beside them. `/messages/r/[slug]` only forwards an old room
	// link to its text channel now (#2458), and lights nothing either.
	// Exactly one row is current, which is why the heading carries the index.
	it('leaves the messages tree to the rows the sidebar draws for it', () => {
		expect(activeHref('/messages')).toBeUndefined();
		expect(activeHref('/messages/dm/rider-1')).toBeUndefined();
		expect(activeHref('/messages/r/velvet-hammer')).toBeUndefined();
	});

	it('has no entry for a path outside the three', () => {
		// An old room link only forwards to its channel now (#2458), and a channel
		// lights its own row, not a destination — and /settings is the cog, which
		// is a setting rather than a place.
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

	// An old room link to its chat is not under this heading: it forwards to
	// a text channel (#2458), whose own row in the crew above is always drawn.
	it('leaves an old room chat link to the text channel it forwards to', () => {
		expect(dmsCurrent('/messages/r/velvet-hammer', false)).toBe(false);
		expect(dmsCurrent('/messages/r/velvet-hammer', true)).toBe(false);
	});

	it('says nothing off the messages tree', () => {
		expect(dmsCurrent('/home', false)).toBe(false);
		expect(dmsCurrent('/crews/directory', false)).toBe(false);
	});
});

describe('a crew in the sidebar (#2447)', () => {
	// ADR-0058's order (#2569): the pages were built and never listed, so a
	// crew's plans were reachable only from your own Home.
	it('lists its pages in the ADR’s order — Settings for admins on a desk', () => {
		const labels = (admin: boolean, narrow: boolean) =>
			crewPlaces('c1', admin, narrow).map((p) => p.label);
		const everyone = ['Home', 'Schedule', 'Workouts', 'Board', 'Members'];
		expect(labels(true, false)).toEqual([...everyone, 'Settings']);
		expect(labels(false, false)).toEqual(everyone);
		// The 95% rule: nobody renames a crew from a bike.
		expect(labels(true, true)).toEqual(everyone);
	});

	it('knows which crew a path stands in', () => {
		expect(crewOfPath('/crew/c1')).toBe('c1');
		expect(crewOfPath('/crew/c1/v/v1/training')).toBe('c1');
		expect(crewOfPath('/crews/directory')).toBeUndefined();
		expect(crewOfPath('/home')).toBeUndefined();
	});
});

describe('which crew the column is in (#2581)', () => {
	const crews = [{ id: 'c1' }, { id: 'c2' }];

	it('is the crew a path stands in, whatever was chosen', () => {
		expect(columnCrew('/crew/c2/schedule', crews, 'c1')?.id).toBe('c2');
		expect(columnCrew('/crew/gone', crews, 'c1')).toBeNull();
	});

	it('is You on your own Home and what Home covers', () => {
		expect(columnCrew('/home', crews, 'c1')).toBeNull();
		expect(columnCrew('/crews/directory', crews, 'c1')).toBeNull();
	});

	// Only You lists them, so only You can light their row (#2581 took the
	// YOU section back out of a crew's column).
	it('is You on your other pages too', () => {
		for (const path of ['/workouts', '/ride', '/history', '/music', '/friends'])
			expect(columnCrew(path, crews, 'c1'), path).toBeNull();
	});

	it('keeps the chosen crew anywhere else', () => {
		expect(columnCrew('/settings/profile', crews, 'c1')?.id).toBe('c1');
	});

	it('is You when You was chosen', () => {
		expect(columnCrew('/workouts', crews, 'you')).toBeNull();
		expect(columnCrew('/workouts', crews, null)).toBeNull();
	});
});
