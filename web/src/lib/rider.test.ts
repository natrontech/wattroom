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

	it('names the voice channel only when the server did (ADR-0012 boundary)', () => {
		// The names since ADR-0058 (#3361); the old ones are the server's to
		// send for a release, not the page's to read.
		expect(ridePlace({ withCrew: true, channelName: 'Schwitzchaste' })).toBe(
			'Schwitzchaste',
		);
		expect(ridePlace({ withCrew: true })).toBe('in a session');
		expect(ridePlace({ withCrew: false })).toBe('solo');
	});

	it('sums medals across kinds', () => {
		expect(medalTotal({})).toBe(0);
		expect(medalTotal({ hammer: 2, diesel: 1 })).toBe(3);
	});
});
