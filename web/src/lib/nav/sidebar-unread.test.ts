import { describe, expect, it } from 'vitest';
import type { LiveCrew } from '$lib/crews-live';
import { sidebarUnread } from './sidebar-unread';

const crew = (...unread: (number | undefined)[]): LiveCrew =>
	({
		id: 'c',
		name: 'Crew',
		role: 'member',
		channels: unread.map((n, i) => ({ id: `ch${i}`, unread: n })),
	}) as unknown as LiveCrew;

describe('the sidebar’s unread, as one number (#3008)', () => {
	it('adds each crew’s unread lines, each unread conversation and each request', () => {
		expect(
			sidebarUnread(
				[crew(2, undefined, 1), crew(4)],
				[{ unread: true }, { unread: false }, {}, { unread: true }],
				1,
			),
		).toBe(2 + 1 + 4 + 2 + 1);
	});

	it('is nothing when nothing is waiting', () => {
		expect(sidebarUnread([crew(0), crew()], [{}], 0)).toBe(0);
		expect(sidebarUnread([], [], 0)).toBe(0);
	});
});
