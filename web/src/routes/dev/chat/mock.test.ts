import { describe, expect, it } from 'vitest';
import { orderThreads } from '$lib/messages/threads';
import { missedSince } from '$lib/room/unread';
import {
	backlog,
	dmUnread,
	heads,
	hereChat,
	hereSeenAt,
	readAt,
	rooms,
	unreadSummary,
} from './mock';

const threads = () => orderThreads(rooms, heads, dmUnread);

describe('the scene the mock claims (#451)', () => {
	it('puts what is waiting on top, rooms and DMs in one list', () => {
		expect(threads().map((t) => t.name)).toEqual([
			// unread, most recent first — a room outranks nothing for being a room
			'Schwitzchaste',
			'Sven Gerber',
			'Natron Lunch Crew',
			// read, most recent first; the never-spoken-in room sorts last
			'Thursday Sufferfest',
			'David Kneubühler',
			'Winter Base Camp',
		]);
	});

	it('shows three new in the thread you open from outside', () => {
		const fresh = backlog.filter((m) => m.at > readAt && m.fromId !== 'jan');
		expect(fresh).toHaveLength(3);
	});

	it('answers the room you are standing in with what you missed, not a count', () => {
		const here = threads().find((t) => t.name === 'Thursday Sufferfest');
		expect(here?.unread).toBe(0);
		expect(missedSince(hereChat, hereSeenAt, 'jan')).toEqual({
			count: 2,
			from: 'Sara',
			preview: 'sent an image',
		});
	});
});

describe('unreadSummary', () => {
	it('adds up what is waiting across rooms and DMs', () => {
		expect(unreadSummary(threads())).toMatchObject({
			rooms: 2,
			dms: 1,
			count: 11,
		});
	});

	it('names the thread to open first — unread, most recently spoken in', () => {
		expect(unreadSummary(threads()).next?.name).toBe('Schwitzchaste');
	});

	it('says nothing is waiting when nothing is', () => {
		const quiet = orderThreads(
			rooms.map((room) => ({ ...room, unread: 0 })),
			heads,
			() => false,
		);
		expect(unreadSummary(quiet)).toEqual({
			rooms: 0,
			dms: 0,
			count: 0,
			next: undefined,
		});
	});
});
