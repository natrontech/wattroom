import { describe, expect, it } from 'vitest';
import { crewsOf, currentCrew, sidebarGroups } from './crews';
import type { RailRoom } from '$lib/room/mockcompat';

const natron = { id: 'c1', name: 'Natron', role: 'owner' as const };
const sunday = { id: 'c2', name: 'Sunday Long', role: 'member' as const };

function room(slug: string, crew?: RailRoom['crew']): RailRoom {
	return { slug, name: slug, live: false, members: 1, crew };
}

const rooms = [
	room('thursday', natron),
	room('lounge', natron),
	room('sufferfest', sunday),
	room('orphan'),
];

describe('crewsOf', () => {
	it('lists each crew once, in the order the rooms mention them', () => {
		expect(crewsOf(rooms).map((c) => c.name)).toEqual([
			'Natron',
			'Sunday Long',
		]);
	});
});

describe('currentCrew', () => {
	const crews = crewsOf(rooms);

	it('honours a choice that is still one of yours', () => {
		expect(currentCrew(crews, 'c2', rooms, 'thursday')?.id).toBe('c2');
	});

	it('falls back to the crew of the room you are standing in', () => {
		expect(currentCrew(crews, 'gone', rooms, 'sufferfest')?.id).toBe('c2');
	});

	it('falls back to the first crew with nothing else to go on', () => {
		expect(currentCrew(crews, null, rooms, '')?.id).toBe('c1');
	});

	it('is null when no room has a crew yet', () => {
		expect(currentCrew([], null, [room('orphan')], 'orphan')).toBeNull();
	});
});

describe('sidebarGroups', () => {
	it('shows one crew at a time, and every crewless room regardless', () => {
		const { rooms: shown, pinned } = sidebarGroups(rooms, natron, '');
		expect(shown.map((r) => r.slug)).toEqual(['thursday', 'lounge', 'orphan']);
		expect(pinned).toBeNull();
	});

	// The part that is not optional (#1147, rider report #416): the room you
	// are connected to stays reachable whichever crew is on screen. Nothing
	// errors when this breaks — a place just gets two clicks further away —
	// so the PR removed the pin, watched this fail, and put it back.
	it('pins the connected room above another crew', () => {
		const { rooms: shown, pinned } = sidebarGroups(rooms, sunday, 'thursday');
		expect(shown.map((r) => r.slug)).toEqual(['sufferfest', 'orphan']);
		expect(pinned?.slug).toBe('thursday');
	});

	it('does not pin a room the list already shows', () => {
		expect(sidebarGroups(rooms, natron, 'thursday').pinned).toBeNull();
	});

	it('shows everything when no crew is on screen', () => {
		expect(sidebarGroups(rooms, null, '').rooms).toHaveLength(4);
	});
});
