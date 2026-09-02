import { describe, expect, it } from 'vitest';
import { medalTotal, monthLine, ridePlace, rideLine } from './rider';

describe("a rider's page prose", () => {
	it('reads a shared ride as duration, energy and execution', () => {
		expect(rideLine({ seconds: 48 * 60, kj: 612, execution: 0.957 })).toBe(
			'48 min · 612 kJ · 96% on target',
		);
	});

	it('reads the month as time and energy', () => {
		expect(monthLine({ seconds: 9 * 3600 + 40 * 60, kj: 810 })).toBe(
			'9 h 40 · 810 kJ',
		);
	});

	it('names the room only when the server did (ADR-0012 boundary)', () => {
		expect(ridePlace({ inRoom: true, roomName: 'Schwitzchaste' })).toBe(
			'Schwitzchaste',
		);
		expect(ridePlace({ inRoom: true })).toBe('in a room');
		expect(ridePlace({ inRoom: false })).toBe('solo');
	});

	it('sums medals across kinds', () => {
		expect(medalTotal({})).toBe(0);
		expect(medalTotal({ hammer: 2, diesel: 1 })).toBe(3);
	});
});
