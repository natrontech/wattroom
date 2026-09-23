import { describe, expect, it } from 'vitest';
import { messageTimeline, type TimelineMessage } from './timeline';

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
