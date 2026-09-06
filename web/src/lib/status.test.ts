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
		room({ slug: 'a', riders: ['Sven Gerber'] }),
		room({
			slug: 'b',
			riders: ['Jan Lauber', 'Mike Frei'],
			riding: ['Mike Frei'],
		}),
	];

	it('says nothing about someone the feed cannot see', () => {
		expect(statusOf(rooms, 'David Kneubühler')).toBe(null);
		expect(statusOf(rooms, '')).toBe(null);
	});

	it('is online in a room and riding with watts', () => {
		expect(statusOf(rooms, 'Jan Lauber')).toBe('online');
		expect(statusOf(rooms, 'Mike Frei')).toBe('riding');
	});

	it('names the room they are in', () => {
		expect(roomOf(rooms, 'Sven Gerber')?.slug).toBe('a');
		expect(roomOf(rooms, 'Nobody')).toBe(undefined);
	});
});

describe('statusOfRider', () => {
	it('prefers what the rider said over what the trainer shows', () => {
		expect(statusOfRider({ away: true, watts: 210 })).toBe('away');
		expect(statusOfRider({ watts: 210 })).toBe('riding');
		expect(statusOfRider({ watts: 0 })).toBe('online');
		expect(statusOfRider({})).toBe('online');
	});
});
