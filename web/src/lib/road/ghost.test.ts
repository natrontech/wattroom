import { describe, expect, it } from 'vitest';
import { formatSplit, ghostSecondsTo, splitAt } from './ghost';

// Your ghost rode 5 m a second from the start (#3033).
const ghost = Array.from({ length: 601 }, (_, t) => 5 * t);

describe('racing your ghost (#3033)', () => {
	it('knows when the ghost passed a metre, between its seconds', () => {
		expect(ghostSecondsTo(ghost, 1000)).toBe(200);
		expect(ghostSecondsTo(ghost, 1002.5)).toBeCloseTo(200.5, 10);
		expect(ghostSecondsTo(ghost, 5000)).toBeNull();
	});

	it('splits negative when you are ahead, positive when behind', () => {
		// At halfway, 1.5 km: the ghost took 300 s.
		expect(splitAt(ghost, 1500, 288)).toBe(-12);
		expect(splitAt(ghost, 1500, 308)).toBe(8);
		expect(splitAt(ghost, 4000, 700)).toBeNull();
	});

	it('reads as the riding surface says it', () => {
		expect(formatSplit(-12)).toBe('−0:12');
		expect(formatSplit(8.4)).toBe('+0:08');
		expect(formatSplit(-75)).toBe('−1:15');
	});
});
