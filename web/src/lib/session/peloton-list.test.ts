import { describe, expect, it } from 'vitest';
import type { LiveRider } from '$lib/channel/types';
import { offsetWindow, pelotonRows } from '$lib/session/peloton-list';

const rider = (id: string, you = false) => ({ id, you }) as LiveRider;
const crew = ['a', 'b', 'c', 'd', 'e'].map((id) => rider(id, id === 'e'));

describe('pelotonRows', () => {
	it('settled: you and the 3 nearest, in list order', () => {
		const ids = pelotonRows(
			crew,
			{ a: 40, b: -2, c: 9, d: -20, e: 1 },
			true,
		).map((r) => r.id);
		expect(ids).toEqual(['b', 'c', 'd', 'e']);
	});
	it('unsettled: everyone', () => {
		expect(pelotonRows(crew, {}, false)).toHaveLength(5);
	});
});

describe('offsetWindow', () => {
	it('expands on a move over 5 m in 10 s and settles once it is out of the window', () => {
		const w = offsetWindow();
		expect(w.settled(0, { a: 10 })).toBe(true);
		expect(w.settled(4000, { a: 15 })).toBe(true);
		expect(w.settled(8000, { a: 15.5 })).toBe(false);
		expect(w.settled(18_100, { a: 15.5 })).toBe(true);
	});
});
