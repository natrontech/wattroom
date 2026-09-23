import { describe, expect, it } from 'vitest';
import { formatThreadWhen, orderThreads } from './threads';
import type { DmHead } from '$lib/dm/heads.svelte';

const head = (over: Partial<DmHead>): DmHead => ({
	peerId: 'p',
	peerName: 'Sven Gerber',
	text: 'ftp test next week?',
	mine: false,
	at: 0,
	...over,
});

describe('orderThreads', () => {
	it('puts unread first, then the most recent, then the silent by name', () => {
		const threads = orderThreads(
			[
				head({ peerId: 'kim', peerName: 'Kim', at: 300 }),
				head({ peerId: 'sven', peerName: 'Sven', at: 250 }),
				head({ peerId: 'dave', peerName: 'David', at: 400, mine: true }),
				head({ peerId: 'zoe', peerName: 'Zoe', at: 0 }),
				head({ peerId: 'ari', peerName: 'Ari', at: 0 }),
			],
			(id) => id === 'sven',
		);
		expect(threads.map((t) => t.name)).toEqual([
			'Sven',
			'David',
			'Kim',
			'Ari',
			'Zoe',
		]);
		expect(threads.map((t) => t.unread)).toEqual([
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it('previews who said the last thing, and images as images', () => {
		const preview = (over: Partial<DmHead>) =>
			orderThreads([head(over)], () => false)[0].preview;
		expect(preview({ mine: true, text: 'lol' })).toBe('you: lol');
		expect(preview({})).toBe('Sven Gerber: ftp test next week?');
		expect(preview({ text: '', hasImage: true })).toBe(
			'Sven Gerber: sent an image',
		);
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
