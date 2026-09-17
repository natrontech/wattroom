// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry } from '$lib/context-menu.svelte';
import type { RailRoom } from '$lib/room/room-data';
import { roomMenu } from './room-menu';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

/** What the menu reads top to bottom; a separator reads as an em dash. */
const labels = (entries: MenuEntry[]): string[] =>
	entries.map((entry) => (entry === 'separator' ? '—' : entry.label));

const room = (over: Partial<RailRoom> = {}) =>
	({ slug: 'kitchen', access: 'crew', role: 'member', ...over }) as RailRoom;

describe('roomMenu (#2171)', () => {
	it('offers the room’s places to a member', () => {
		expect(labels(roomMenu(room(), { here: false }))).toContain('Training');
		expect(labels(roomMenu(room(), { here: false }))).not.toContain(
			'Disconnect',
		);
	});

	it('offers only the door to a crew room you have not walked into', () => {
		// The rest would 403 on click (ux.md: never a button that will fail).
		expect(
			labels(roomMenu(room({ role: undefined }), { here: false })),
		).toEqual(['Walk in']);
	});

	it('offers nothing for a room that is not yours to enter', () => {
		expect(roomMenu(room({ access: 'locked' }), { here: false })).toEqual([]);
	});

	it('offers the disconnect only where there is a connection to drop', () => {
		const leave = vi.fn();
		// A room you are a member of but not standing in: the row is there,
		// the connection is not.
		expect(
			labels(roomMenu(room(), { here: false, onLeave: leave })),
		).not.toContain('Disconnect');
		const entries = roomMenu(room(), { here: true, onLeave: leave });
		expect(labels(entries).slice(-2)).toEqual(['—', 'Disconnect']);
		// Not the crew's exit: nothing here leaves the room for good.
		expect(labels(entries)).not.toContain('Leave the room');
		// No handler, nothing to offer: the entry is the layout's own leave.
		expect(labels(roomMenu(room(), { here: true }))).not.toContain(
			'Disconnect',
		);
	});
});
