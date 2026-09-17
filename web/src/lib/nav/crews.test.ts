import { describe, expect, it } from 'vitest';
import {
	creationCrew,
	crewPulse,
	crewsOf,
	currentCrew,
	administersNone,
	leadsWithJoining,
	openableCrews,
	quiet,
	sidebarGroups,
} from './crews';
import type { RailRoom } from '$lib/room/room-data';

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
	it('keeps a crew with no rooms, from the list the server sends (#1476)', () => {
		const empty = { id: 'c7', name: 'Roomless', role: 'member' as const };
		expect(crewsOf(rooms, [natron, empty]).map((c) => c.id)).toEqual([
			'c1',
			'c7',
			'c2',
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

describe('crewPulse', () => {
	const live: RailRoom[] = [
		{
			...room('thursday', natron),
			riding: ['Sven', 'Lena'],
			voice: ['Sven'],
			unread: 3,
		},
		{ ...room('lounge', natron), voice: ['David', 'Kim'], unread: 2 },
		{ ...room('sufferfest', sunday), riding: ['Ana'] },
		room('orphan'),
	];

	it('sums riding, voice and unread over the crew rooms only', () => {
		expect(crewPulse(live, 'c1')).toEqual({ riding: 2, voice: 3, unread: 5 });
		expect(crewPulse(live, 'c2')).toEqual({ riding: 1, voice: 0, unread: 0 });
	});

	// Silent if it breaks: a crew with nothing on shows three zeroes on a
	// surface read at three metres, and nothing errors. Seen red in the PR.
	it('is quiet only when nothing at all is happening', () => {
		expect(quiet(crewPulse(live, 'nobody'))).toBe(true);
		expect(quiet({ riding: 1, voice: 0, unread: 0 })).toBe(false);
		expect(quiet({ riding: 0, voice: 1, unread: 0 })).toBe(false);
		expect(quiet({ riding: 0, voice: 0, unread: 1 })).toBe(false);
	});
});

describe('creationCrew', () => {
	const admined = { id: 'c3', name: 'Tuesday', role: 'admin' as const };
	const crews = [natron, sunday, admined];

	it('offers the crews you own or administer, never one you only ride in', () => {
		expect(openableCrews(crews).map((c) => c.id)).toEqual(['c1', 'c3']);
	});
	// Three surfaces asked this three ways (#2176): Home's button asked "any
	// crew at all", which is true for a plain member of somebody else's, so
	// they were offered "Open a room" and handed a sheet that led with joining
	// one — and the dialog between them asked nothing and was always "Open a
	// room".
	it('says a rider has nowhere to open a room, membership alone not counting', () => {
		expect(administersNone([])).toBe(true);
		expect(administersNone([sunday])).toBe(true);
		expect(administersNone([natron])).toBe(false);
		expect(administersNone([admined])).toBe(false);
		expect(administersNone(crews)).toBe(false);
	});
	// The landing's one CTA is "Open your first room" (routes/+page.svelte),
	// and #2144 keyed the sheet's order on administering nothing — so every
	// stranger who took the front door at its word met a code box (#2184).
	it('leads with joining only for a rider carrying an invite', () => {
		expect(leadsWithJoining([], 'AB23CD')).toBe(true);
		expect(leadsWithJoining([sunday], 'AB23CD')).toBe(true);
		expect(leadsWithJoining([], undefined)).toBe(false);
		expect(leadsWithJoining([], null)).toBe(false);
		expect(leadsWithJoining([], '')).toBe(false);
		expect(leadsWithJoining([sunday], undefined)).toBe(false);
	});
	// The invite rides the account, read once; the room list moves first. A
	// rider who founds a crew in-session still carries the stale code.
	it('stops leading with joining once the rider has a crew to open rooms in', () => {
		expect(leadsWithJoining([natron], 'AB23CD')).toBe(false);
		expect(leadsWithJoining(crews, 'AB23CD')).toBe(false);
	});
	it('lands in the crew on screen when you may open rooms there', () => {
		expect(creationCrew(openableCrews(crews), 'c3')?.id).toBe('c3');
	});
	it('falls back to your own crew when the one on screen is not yours to open in', () => {
		expect(creationCrew(openableCrews(crews), 'c2')?.id).toBe('c1');
	});
	it('lands in the crew you founded before one that was handed to you (#1928)', () => {
		const handed = { id: 'c8', name: 'Handed on', role: 'owner' as const };
		const founded = {
			id: 'c9',
			name: 'Mine',
			role: 'owner' as const,
			founded: true,
		};
		expect(creationCrew(openableCrews([handed, founded]), undefined)?.id).toBe(
			'c9',
		);
	});
	it('is null before the room list has landed', () => {
		expect(creationCrew([], 'c1')).toBeNull();
	});
	it('lands in the crew whose page asked, before it has any rooms (audit 2026-09-09)', () => {
		const empty = { id: 'c9', name: 'Brand new', role: 'owner' as const };
		expect(creationCrew(openableCrews(crews), undefined, empty)?.id).toBe('c9');
		expect(creationCrew(openableCrews(crews), 'c3')?.id).toBe('c3');
	});
});
