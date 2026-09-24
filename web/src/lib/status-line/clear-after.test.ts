import { describe, expect, it } from 'vitest';
import { clearsAt } from './clear-after';

// Local times throughout: "today" and "this week" are the rider's own.
const wednesday = new Date(2026, 8, 23, 15, 20);
const local = (iso: string) => {
	const at = new Date(iso);
	return [at.getDay(), at.getDate(), at.getHours(), at.getMinutes()];
};

describe('clearsAt', () => {
	it('adds the short presets to now', () => {
		expect(local(clearsAt('30m', wednesday))).toEqual([3, 23, 15, 50]);
		expect(local(clearsAt('1h', wednesday))).toEqual([3, 23, 16, 20]);
		expect(local(clearsAt('4h', wednesday))).toEqual([3, 23, 19, 20]);
	});

	it('ends today at the next local midnight', () => {
		expect(local(clearsAt('today', wednesday))).toEqual([4, 24, 0, 0]);
	});

	it('ends the week when the local Sunday does', () => {
		expect(local(clearsAt('week', wednesday))).toEqual([1, 28, 0, 0]);
		// Set on the Sunday itself, it is that night — not a week later.
		expect(local(clearsAt('week', new Date(2026, 8, 27, 9)))).toEqual([
			1, 28, 0, 0,
		]);
		// And set on a Monday, the Sunday six days on.
		expect(local(clearsAt('week', new Date(2026, 8, 28, 9)))).toEqual([
			1, 5, 0, 0,
		]);
	});

	it("says nothing for don't clear", () => {
		expect(clearsAt('never', wednesday)).toBe('');
	});
});
