import { describe, expect, it } from 'vitest';
import { endRideLabel, roadEndOffered } from './road-end';

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

	it('saves an early stop at its kilometre, and nothing else', () => {
		expect(endRideLabel(at(21_340, false))).toBe('Save at km 21.3');
		expect(endRideLabel(at(2000, true))).toBe('End ride');
		expect(endRideLabel(at(800, false, 1))).toBe('End ride');
		expect(endRideLabel({ road: null })).toBe('End ride');
		// A borrowed road saves without its route: nowhere to carry on (#3621).
		expect(
			endRideLabel({
				road: { m: 1200, atEnd: false, lap: 0, borrowed: true },
			}),
		).toBe('End ride');
	});
});
