/**
 * Fixtures for the chat mock (#451), shaped as the real types so the page can
 * run the SHIPPED logic over them — `orderThreads`, `formatThreadWhen`,
 * `missedSince`, the unread marks. A mock that redraws the rules instead of
 * importing them is a second design to keep in step (ADR-0020, "the mock is
 * gone").
 *
 * The scene: you are standing in Thursday Sufferfest, on its Training place.
 * Schwitzchaste and the lunch crew have been talking without you, and one
 * room has never had a word said in it.
 */
import type { ChatLine } from '$lib/protocol';
import type { DmHead } from '$lib/dm/heads.svelte';
import type { RailRoom } from '$lib/room/mockcompat';
import type { Thread } from '$lib/messages/threads';

/** Fixed clock: a gallery must not read differently depending on when you open it. */
export const NOW = new Date(2026, 8, 3, 20, 42).getTime();
const MIN = 60_000;

/** The room you are standing in — its chat is the live one, not a polled backlog. */
export const HERE = 'thursday';
/** The room the mocked thread is open on: you are not in it. */
export const OUTSIDE = 'schwitzchaste';

export const rooms: RailRoom[] = [
	{
		name: 'Schwitzchaste',
		slug: OUTSIDE,
		icon: 'flame',
		live: true,
		members: 6,
		connected: 3,
		riders: ['David', 'Mike', 'Nina'],
		voice: ['David', 'Mike'],
		riding: ['David'],
		unread: 3,
		lastChat: { from: 'David', text: 'queue this one', at: NOW - 4 * MIN },
	},
	{
		name: 'Natron Lunch Crew',
		slug: 'natron-lunch',
		icon: 'coffee',
		live: false,
		members: 5,
		connected: 0,
		unread: 7,
		lastChat: {
			from: 'Mike',
			text: 'who is riding tonight?',
			at: NOW - 21 * MIN,
		},
	},
	{
		// Standing in a room counts as reading it (#468), so this one shows no
		// count however long the chat has been running past your shoulder.
		name: 'Thursday Sufferfest',
		slug: HERE,
		icon: 'skull',
		live: true,
		members: 4,
		connected: 4,
		riders: ['You', 'Sara', 'Ruben', 'Nina'],
		voice: ['Sara', 'Ruben'],
		riding: ['You', 'Sara', 'Ruben'],
		unread: 0,
		lastChat: { from: 'Sara', text: '', hasImage: true, at: NOW - 6 * MIN },
	},
	{
		name: 'Winter Base Camp',
		slug: 'winter-base',
		icon: 'snowflake',
		live: false,
		members: 3,
		connected: 0,
		unread: 0,
	},
];

export const heads: DmHead[] = [
	{
		peerId: 'sven',
		peerName: 'Sven Gerber',
		text: 'ftp test next week?',
		mine: false,
		at: NOW - 13 * MIN,
	},
	{
		peerId: 'david',
		peerName: 'David Kneubühler',
		text: 'lol',
		mine: true,
		at: NOW - 26 * 60 * MIN,
	},
];

/** Which DMs are unread — a reader-local stamp today (`dm.svelte.ts`), never a server fact. */
export const dmUnread = (peerId: string) => peerId === 'sven';

/**
 * What is waiting for you across every thread at once. Nothing in the app
 * computes this today: the sidebar counts each room and dots each DM, and
 * below `md` the whole sidebar is a drawer behind one button — so a room you
 * are not in can be shouting with nothing on screen to say so. Proposed here
 * (#451, rider ask 1); it belongs beside `orderThreads` in
 * `$lib/messages/threads.ts` if the badge turns out to be the answer.
 */
export interface UnreadSummary {
	/** Rooms with something new — a room is counted server-side. */
	rooms: number;
	/** DMs with something new — a DM knows only that, not how much. */
	dms: number;
	/** Lines waiting in rooms plus one per unread DM: what a badge would show. */
	count: number;
	/** The thread to open first — unread, most recently spoken in. */
	next?: Thread;
}

export function unreadSummary(threads: Thread[]): UnreadSummary {
	const unread = threads.filter((thread) => thread.unread > 0);
	return {
		rooms: unread.filter((thread) => thread.kind === 'room').length,
		dms: unread.filter((thread) => thread.kind === 'dm').length,
		count: unread.reduce((n, thread) => n + thread.unread, 0),
		next: unread.reduce<Thread | undefined>(
			(best, thread) => (!best || thread.at > best.at ? thread : best),
			undefined,
		),
	};
}

/** A line in the mocked thread, plus the reaction counts the real log carries. */
export interface MockLine extends ChatLine {
	id: string;
	reactions?: Record<string, number>;
}

/** Schwitzchaste's backlog as it reads from outside: no room events, just words. */
export const backlog: MockLine[] = [
	{
		id: 'm1',
		from: 'Sven Gerber',
		fromId: 'sven',
		at: NOW - 62 * MIN,
		text: 'anyone up for sweet spot later',
	},
	{
		id: 'm2',
		from: 'Mike Frei',
		fromId: 'mike',
		at: NOW - 58 * MIN,
		text: 'me, 19:30',
		reactions: { 'biceps-flexed': 1 },
	},
	{
		id: 'm3',
		from: 'David Kneubühler',
		fromId: 'david',
		at: NOW - 11 * MIN,
		text: '@Jan you in? https://www.youtube.com/watch?v=LwFo68d3Lx0',
	},
	{
		id: 'm4',
		from: 'Mike Frei',
		fromId: 'mike',
		at: NOW - 9 * MIN,
		text: 'he is in the sufferfest, he cannot hear you',
	},
	{
		id: 'm5',
		from: 'David Kneubühler',
		fromId: 'david',
		at: NOW - 4 * MIN,
		text: 'queue this one',
		reactions: { flame: 3, 'party-popper': 1 },
	},
];

/** Where you had read up to — the three lines after it are the "N new" run. */
export const readAt = NOW - 30 * MIN;

/**
 * The chat of the room you ARE in, running past your shoulder while you look
 * at Training. Its unread count is zero by definition, so the people column
 * answers with `missedSince` instead (#504).
 */
export const hereChat: ChatLine[] = [
	{ id: 'h1', from: 'Sara', fromId: 'sara', at: NOW - 14 * MIN, text: 'legs' },
	{
		id: 'h2',
		from: 'Ruben',
		fromId: 'ruben',
		at: NOW - 11 * MIN,
		text: 'this is not sweet spot this is threshold',
	},
	{
		id: 'h3',
		from: 'Nina',
		fromId: 'nina',
		at: NOW - 8 * MIN,
		text: 'speak for yourself',
	},
	{
		id: 'h4',
		from: 'Sara',
		fromId: 'sara',
		at: NOW - 6 * MIN,
		text: '',
		imageId: 'sara-turbo',
	},
];

/** When the Chat place was last open — what "seen" means for the room you are in. */
export const hereSeenAt = NOW - 10 * MIN;
