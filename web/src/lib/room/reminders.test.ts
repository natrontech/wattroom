import { describe, expect, it } from 'vitest';
import { remindersFor } from './reminders';
import { eventText, roomTimeline } from './timeline';

/**
 * "This starts in ten minutes" (#359). The reporter asked for reminders on
 * the room's timeline and the line was built, rendered by `eventText`, and
 * then wired to nothing — `room.reminders` had no reader in any commit, so
 * it never appeared. These cover the whole path, not just the maths, because
 * the maths was never the part that was broken.
 */

const START = Date.UTC(2026, 8, 8, 19, 0);
const plan = (over = {}) => ({
	id: 'p1',
	workoutName: 'Sweet Spot 3×12',
	startsAt: new Date(START).toISOString(),
	...over,
});

describe('remindersFor', () => {
	it('says nothing until the session is close', () => {
		expect(remindersFor([plan()], START - 60 * 60_000)).toHaveLength(0);
	});

	it('speaks up inside the lead time', () => {
		expect(remindersFor([plan()], START - 5 * 60_000)).toHaveLength(1);
	});

	it('stops once the session is well past', () => {
		expect(remindersFor([plan()], START + 45 * 60_000)).toHaveLength(0);
	});

	it('pins the line where it comes due, not where it was computed', () => {
		// Otherwise it walks down the log as the clock ticks.
		const [a] = remindersFor([plan()], START - 9 * 60_000);
		const [b] = remindersFor([plan()], START - 2 * 60_000);
		expect(a.at).toBe(b.at);
	});
});

describe('the reminder reaches the timeline', () => {
	it('renders as a line rather than nothing', () => {
		const [due] = remindersFor([plan()], START - 5 * 60_000);
		// An unknown verb renders '' and roomTimeline drops it — which is
		// exactly how this could go quiet again.
		expect(eventText(due)).not.toBe('');
		expect(eventText(due)).toContain('Sweet Spot 3×12');
	});

	it('merges into the room timeline beside the messages', () => {
		const due = remindersFor([plan()], START - 5 * 60_000);
		const lines = roomTimeline(
			[{ from: 'Kim', text: 'here', at: START - 8 * 60_000 }],
			due,
		);
		expect(lines.map((l) => l.kind)).toContain('event');
		expect(lines).toHaveLength(2);
	});
});
