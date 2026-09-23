import { describe, expect, it } from 'vitest';
import { orderThreads } from '$lib/messages/threads';
import { backlog, dmUnread, heads, readAt, unreadSummary } from './mock';

const threads = () => orderThreads(heads, dmUnread);

describe('the scene the mock claims (#451)', () => {
	it('puts what is waiting on top, then the most recent', () => {
		expect(threads().map((t) => t.name)).toEqual([
			// unread outranks a newer line that has been read
			'Sven Gerber',
			'Nina Brunner',
			'David Kneubühler',
		]);
	});

	it('shows two new in the thread you open', () => {
		const fresh = backlog.filter((m) => m.at > readAt && m.fromId !== 'jan');
		expect(fresh).toHaveLength(2);
	});
});

describe('unreadSummary', () => {
	it('counts the conversations with something new', () => {
		expect(unreadSummary(threads()).count).toBe(1);
	});

	it('names the thread to open first — unread, most recently spoken in', () => {
		expect(unreadSummary(threads()).next?.name).toBe('Sven Gerber');
	});

	it('says nothing is waiting when nothing is', () => {
		expect(unreadSummary(orderThreads(heads, () => false))).toEqual({
			count: 0,
			next: undefined,
		});
	});
});
