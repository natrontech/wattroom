import { describe, expect, it } from 'vitest';
import type { RailRoom } from '$lib/room/mockcompat';
import { roomOf, statusOf, statusOfRider } from './status';

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

	it('names the room they are in', () => {
		expect(roomOf(rooms, 'u-sven')?.slug).toBe('a');
		expect(roomOf(rooms, 'u-nobody')).toBe(undefined);
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
