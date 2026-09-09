import { describe, expect, it } from 'vitest';
import type { RailRoom } from '$lib/room/room-data';
import { othersIn, roomOf, statusOf, statusOfRider } from './status';

const room = (over: Partial<RailRoom> = {}): RailRoom => ({
	name: 'MFW 5',
	slug: 'mfw-5',
	live: false,
	members: 5,
	...over,
});

describe('statusOf', () => {
	const rooms = [
		room({ slug: 'a', riders: ['Sven Gerber'], riderIds: ['u-sven'] }),
		room({
			slug: 'b',
			riders: ['Jan Lauber', 'Mike Frei'],
			riderIds: ['u-jan', 'u-mike'],
			riding: ['Mike Frei'],
			ridingIds: ['u-mike'],
		}),
	];

	it('says nothing about someone the feed cannot see', () => {
		expect(statusOf(rooms, 'u-david')).toBe(null);
		expect(statusOf(rooms, '')).toBe(null);
	});

	it('is online in a room and riding with watts', () => {
		expect(statusOf(rooms, 'u-jan')).toBe('online');
		expect(statusOf(rooms, 'u-mike')).toBe('riding');
	});

	it('is away when the rider said so, whatever the watts (#1742)', () => {
		const rooms = [
			room({
				slug: 'cave',
				riderIds: ['u-mike'],
				ridingIds: ['u-mike'],
				awayIds: ['u-mike'],
			}),
		];
		expect(statusOf(rooms, 'u-mike')).toBe('away');
	});

	it('names the room they are in', () => {
		expect(roomOf(rooms, 'u-sven')?.slug).toBe('a');
		expect(roomOf(rooms, 'u-nobody')).toBe(undefined);
	});

	it('falls back to the friends list when the feed cannot see them', () => {
		// #1434: a friend with the app open but not in a room you can see read
		// as nothing in the DM list, while the friends panel said online.
		const friends = [
			{
				id: 'u-anna',
				name: 'Anna',
				status: 'accepted' as const,
				at: 0,
				online: true,
			},
			{ id: 'u-ben', name: 'Ben', status: 'accepted' as const, at: 0 },
			{ id: 'u-cid', name: 'Cid', status: 'pending_in' as const, at: 0 },
		];
		expect(statusOf(rooms, 'u-anna', friends)).toBe('online');
		expect(statusOf(rooms, 'u-ben', friends)).toBe('offline');
		// A pending request carries no presence (ADR-0012) — say nothing.
		expect(statusOf(rooms, 'u-cid', friends)).toBe(null);
		expect(statusOf(rooms, 'u-david', friends)).toBe(null);
		// The feed wins where it has something: riding beats the list's online.
		expect(
			statusOf(rooms, 'u-mike', [
				{ id: 'u-mike', name: 'Mike', status: 'accepted', at: 0, online: true },
			]),
		).toBe('riding');
	});

	it('does not answer for a namesake', () => {
		// #649: two riders called Dave. The one standing in the room used to
		// answer for the one who is not in it — an "online in MFW 5" badge and
		// a Join button pointing at the wrong person.
		const daves = [
			room({ slug: 'a', riders: ['Dave'], riderIds: ['u-dave-one'] }),
		];
		expect(statusOf(daves, 'u-dave-one')).toBe('online');
		expect(statusOf(daves, 'u-dave-two')).toBe(null);
		expect(roomOf(daves, 'u-dave-two')).toBe(undefined);
	});
});

describe('statusOfRider', () => {
	it('prefers what the rider said over what the trainer shows', () => {
		expect(statusOfRider({ away: true, riding: true })).toBe('away');
		expect(statusOfRider({ riding: true })).toBe('riding');
		expect(statusOfRider({ riding: false })).toBe('online');
		expect(statusOfRider({})).toBe('online');
	});
});

describe('othersIn', () => {
	it('leaves you out and keeps the others', () => {
		const r = room({
			riders: ['Jan Lauber', 'Mike Frei'],
			riderIds: ['u-jan', 'u-mike'],
		});
		expect(othersIn(r, 'u-jan')).toEqual(['Mike Frei']);
		expect(othersIn(r, 'u-mike')).toEqual(['Jan Lauber']);
		expect(othersIn(r, 'u-x')).toEqual(['Jan Lauber', 'Mike Frei']);
	});

	it('is empty when you are the only one there', () => {
		expect(
			othersIn(room({ riders: ['Jan Lauber'], riderIds: ['u-jan'] }), 'u-jan'),
		).toEqual([]);
		expect(othersIn(room(), 'u-jan')).toEqual([]);
	});
});
