import { describe, expect, it } from 'vitest';
import { isLastWayIn } from './last-way-in';

describe('the last way in (#2879)', () => {
	it('is the account with one credential left, and only that', () => {
		expect(isLastWayIn({ credentials: 1 })).toBe(true);
		expect(isLastWayIn({ credentials: 2 })).toBe(false);
		// An older server, or a count that could not be read: the server's
		// refusal is the backstop, so nothing is disabled on a guess.
		expect(isLastWayIn({})).toBe(false);
		expect(isLastWayIn(null)).toBe(false);
	});
});
