import { describe, expect, it } from 'vitest';
import { roadEndOffered } from './road-end';

const at = (m: number, atEnd: boolean, lap = 0) => ({
	road: { m, atEnd, lap },
});

describe('the end of the road (#3205)', () => {
	it('offers the sheet to a solo ride that reached the end', () => {
		expect(roadEndOffered({ ...at(2000, true), recording: true }, false)).toBe(
			true,
		);
		expect(roadEndOffered({ ...at(1200, false), recording: true }, false)).toBe(
			false,
		);
		expect(roadEndOffered({ road: null, recording: true }, false)).toBe(false);
	});

	it('never shows it to a session ride at its route’s end', () => {
		expect(roadEndOffered({ ...at(2000, true), recording: true }, true)).toBe(
			false,
		);
	});
});
