import { describe, expect, it } from 'vitest';
import { nextHourInput, toLocalInput } from './when';

// Asserted as a round trip, not against a fixed string: the helper's whole job
// is the local/UTC shift, so a test that hard-codes an hour only passes in the
// zone it was written in.
describe('toLocalInput', () => {
	it('round-trips to the same wall-clock minute', () => {
		const when = new Date(2026, 8, 3, 19, 30);
		const back = new Date(toLocalInput(when));
		expect(back.getHours()).toBe(19);
		expect(back.getMinutes()).toBe(30);
		expect(back.getDate()).toBe(3);
	});

	it('formats exactly as datetime-local wants it', () => {
		expect(toLocalInput(new Date(2026, 0, 5, 7, 4))).toBe('2026-01-05T07:04');
	});

	it('does not mutate the date it is given', () => {
		const when = new Date(2026, 8, 3, 19, 30);
		toLocalInput(when);
		expect(when.getHours()).toBe(19);
	});
});

describe('nextHourInput', () => {
	it('lands on a full hour in the future', () => {
		const value = nextHourInput();
		const when = new Date(value);
		expect(when.getMinutes()).toBe(0);
		expect(when.getTime()).toBeGreaterThan(Date.now());
	});
});
