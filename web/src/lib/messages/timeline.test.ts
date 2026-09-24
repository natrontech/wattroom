import { describe, expect, it } from 'vitest';
import {
	arrivedSince,
	messageTimeline,
	type TimelineMessage,
} from './timeline';

const message = (over: Partial<TimelineMessage> = {}): TimelineMessage => ({
	from: 'Ada',
	text: 'warming up',
	at: 1000,
	...over,
});

describe('messageTimeline (#321)', () => {
	it('puts the lines oldest first', () => {
		const lines = messageTimeline([
			message({ at: 3000, text: 'nice one' }),
			message({ at: 1000 }),
		]);
		expect(lines.map((line) => line.at)).toEqual([1000, 3000]);
	});

	it('keys a line by its id, or by when and who before it has one', () => {
		const [sent, pending] = messageTimeline([
			message({ id: 'm1' }),
			message({ at: 2000, from: 'Kim' }),
		]);
		expect(sent.key).toBe('m1');
		expect(pending.key).toBe('m:2000:Kim');
	});
});

describe('arrivedSince (#2703)', () => {
	// What the log held when the reader scrolled back.
	const before = messageTimeline([
		message({ id: 'a', fromId: 'ada', at: 1000 }),
		message({ id: 'b', fromId: 'me', at: 2000 }),
	]);
	const seen = new Set(before.map((entry) => entry.key));

	it('counts each line from someone else, three in one poll as three', () => {
		const now = messageTimeline([
			...before.map((entry) => entry.message),
			message({ id: 'c', fromId: 'ada', at: 3000 }),
			message({ id: 'd', fromId: 'kim', at: 3001 }),
			message({ id: 'e', fromId: 'ada', at: 3002 }),
		]);
		expect(arrivedSince(now, seen, 'me')).toBe(3);
	});

	it('counts nothing for an edit, a delete or a line gone by its timer', () => {
		const now = messageTimeline([
			message({
				id: 'a',
				fromId: 'ada',
				at: 1000,
				text: 'fixed',
				editedAt: 5000,
			}),
			message({ id: 'b', fromId: 'me', at: 2000, deletedAt: 6000 }),
		]);
		expect(arrivedSince(now, seen, 'me')).toBe(0);
		expect(arrivedSince(now.slice(0, 1), seen, 'me')).toBe(0);
	});

	it('does not count your own line', () => {
		const now = messageTimeline([
			...before.map((entry) => entry.message),
			message({ at: 4000, from: 'Me', fromId: 'me' }),
		]);
		expect(arrivedSince(now, seen, 'me')).toBe(0);
	});
});
