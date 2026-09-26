/**
 * Fixtures for the chat mock (#451), shaped as the real types so the page can
 * run the SHIPPED logic over them — `orderThreads`, `formatThreadWhen`, the
 * unread marks. A mock that redraws the rules instead of importing them is a
 * second design to keep in step (ADR-0020, "the mock is gone").
 *
 * The scene: Sven wrote while you were out and you have not opened it yet;
 * Nina's line is newer but read; David's conversation has gone quiet.
 */
import type { ChatLine } from '$lib/protocol';
import type { DmHead } from '$lib/dm/heads.svelte';
import type { Thread } from '$lib/messages/threads';

/** Fixed clock: a gallery must not read differently depending on when you open it. */
export const NOW = new Date(2026, 8, 3, 20, 42).getTime();
const MIN = 60_000;

/** The conversation the mocked thread is open on. */
export const OPEN = 'sven';

export const heads: DmHead[] = [
	{
		peerId: OPEN,
		peerName: 'Sven Gerber',
		text: 'ftp test next week?',
		mine: false,
		at: NOW - 13 * MIN,
	},
	{
		peerId: 'nina',
		peerName: 'Nina Brunner',
		text: 'see you thursday',
		mine: false,
		at: NOW - 3 * MIN,
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
export const dmUnread = (peerId: string) => peerId === OPEN;

/**
 * What is waiting for you across every conversation at once. Nothing in the
 * app computes this today: the sidebar dots each DM, and below `md` the whole
 * sidebar is a drawer behind one button — so a friend can be waiting with
 * nothing on screen to say so. Proposed here (#451, rider ask 1); it belongs
 * beside `orderThreads` in `$lib/messages/threads.ts` if the badge turns out
 * to be the answer.
 */
export interface UnreadSummary {
	/** Conversations with something new — a DM knows only that, not how much. */
	count: number;
	/** The thread to open first — unread, most recently spoken in. */
	next?: Thread;
}

export function unreadSummary(threads: Thread[]): UnreadSummary {
	const unread = threads.filter((thread) => thread.unread);
	return {
		count: unread.length,
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

/** The conversation with Sven, as it reads when you open it. */
export const backlog: MockLine[] = [
	{
		id: 'm1',
		from: 'Sven Gerber',
		fromId: OPEN,
		at: NOW - 62 * MIN,
		text: 'anyone up for sweet spot later',
	},
	{
		id: 'm2',
		from: 'Jan Lauber',
		fromId: 'jan',
		at: NOW - 58 * MIN,
		text: 'me, 19:30',
		reactions: { 'biceps-flexed': 1 },
	},
	{
		id: 'm3',
		from: 'Sven Gerber',
		fromId: OPEN,
		at: NOW - 21 * MIN,
		text: '@Jan warm-up track https://www.youtube.com/watch?v=LwFo68d3Lx0',
		reactions: { flame: 1 },
	},
	{
		id: 'm4',
		from: 'Sven Gerber',
		fromId: OPEN,
		at: NOW - 13 * MIN,
		text: 'ftp test next week?',
	},
];

/** Where you had read up to — the two lines after it are the "N new" run. */
export const readAt = NOW - 30 * MIN;
