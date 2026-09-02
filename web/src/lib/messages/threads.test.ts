import { describe, expect, it } from 'vitest';
import { formatThreadWhen, orderThreads, roomThread } from './threads';
import type { DmHead } from '$lib/dm/heads.svelte';
import type { RailRoom } from '$lib/room/mockcompat';

const room = (over: Partial<RailRoom>): RailRoom => ({
	name: 'Room',
	slug: 'room',
	live: false,
	members: 3,
	...over,
});

const head = (over: Partial<DmHead>): DmHead => ({
	peerId: 'p',
	peerName: 'Sven Gerber',
	text: 'ftp test next week?',
	mine: false,
	at: 0,
	...over,
});

describe('orderThreads', () => {
	it('puts unread first, then the most recent, rooms and DMs alike', () => {
		const threads = orderThreads(
			[
				room({
					name: 'Thursday',
					slug: 'thursday',
					lastChat: { from: 'Kim', text: 'now playing', at: 300 },
				}),
				room({
					name: 'Schwitzchaste',
					slug: 'schwitz',
					unread: 3,
					lastChat: { from: 'David', text: 'queue this one', at: 200 },
				}),
				room({ name: 'Quiet', slug: 'quiet' }),
			],
			[
				head({ peerId: 'sven', peerName: 'Sven', at: 250 }),
				head({ peerId: 'dave', peerName: 'David', at: 400, mine: true }),
			],
			(id) => id === 'sven',
		);
		expect(threads.map((t) => t.name)).toEqual([
			'Sven',
			'Schwitzchaste',
			'David',
			'Thursday',
			'Quiet',
		]);
	});

	it('previews who said the last thing, and images as images', () => {
		expect(
			roomThread(
				room({ lastChat: { from: 'David', text: 'queue this one', at: 1 } }),
			).preview,
		).toBe('David: queue this one');
		expect(
			roomThread(
				room({ lastChat: { from: 'Mike', text: '', hasImage: true, at: 1 } }),
			).preview,
		).toBe('Mike: sent an image');
		expect(roomThread(room({})).preview).toBe('');
		const [dm] = orderThreads(
			[],
			[head({ mine: true, text: 'lol' })],
			() => false,
		);
		expect(dm.preview).toBe('you: lol');
	});

	it('carries the room signal the list shows under the preview', () => {
		const t = roomThread(
			room({ connected: 3, voice: ['a', 'b'], riding: ['a'] }),
		);
		expect(t).toMatchObject({ here: 3, voice: 2, riding: true });
	});
});

describe('formatThreadWhen', () => {
	const now = new Date(2026, 8, 2, 23, 40).getTime();

	it('says the time today, the weekday this week, the date beyond', () => {
		expect(
			formatThreadWhen(new Date(2026, 8, 2, 23, 33).getTime(), now),
		).toMatch(/23:33|11:33/);
		expect(formatThreadWhen(new Date(2026, 8, 1, 9, 0).getTime(), now)).toMatch(
			/^[A-Za-z]{2,4}\.?$/,
		);
		expect(formatThreadWhen(new Date(2026, 7, 10).getTime(), now)).toMatch(
			/10/,
		);
	});

	it('says nothing for a thread that never moved', () => {
		expect(formatThreadWhen(0, now)).toBe('');
	});
});
