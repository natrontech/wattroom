import { describe, expect, it } from 'vitest';
import { createCadenceTracker, delta, REVOLUTION } from './revolutions';

describe('delta', () => {
	it('is a plain difference in the normal case', () => {
		expect(delta(10, 15)).toBe(5);
	});

	it('survives the uint16 wrap', () => {
		// The counter rolled over between packets: 65534 → 2 is four revolutions.
		expect(delta(65534, 2)).toBe(4);
	});
});

describe('createCadenceTracker', () => {
	/** One crank event per second is 60 rpm; event time is in 1/1024 s. */
	it('reports nothing from a single packet', () => {
		const update = createCadenceTracker(() => 0);
		expect(update({ revs: 100, eventTime: 1024 })).toBe(0);
	});

	it('derives rpm from two packets', () => {
		const update = createCadenceTracker(() => 0);
		update({ revs: 100, eventTime: 1024 });
		// One revolution in one second.
		expect(update({ revs: 101, eventTime: 2048 })).toBe(60);
	});

	it('derives rpm across a counter wrap', () => {
		const update = createCadenceTracker(() => 0);
		update({ revs: 65535, eventTime: 65535 });
		// Both counters wrapped: one revolution, one second later.
		expect(update({ revs: 0, eventTime: 1023 })).toBe(60);
	});

	it('holds the last cadence briefly when no crank event has arrived', () => {
		let clock = 0;
		const update = createCadenceTracker(() => clock);
		update({ revs: 100, eventTime: 1024 });
		expect(update({ revs: 190, eventTime: 2048 })).toBe(REVOLUTION.maxRpm);

		// A repeated packet one second later: between events, not stopped.
		clock += 1000;
		expect(update({ revs: 190, eventTime: 2048 })).toBe(REVOLUTION.maxRpm);
	});

	it('falls to zero once the crank has not turned for the stale window', () => {
		let clock = 0;
		const update = createCadenceTracker(() => clock);
		update({ revs: 100, eventTime: 1024 });
		update({ revs: 101, eventTime: 2048 });

		clock += REVOLUTION.staleSeconds * 1000;
		// The rider stopped; the sensor is still repeating its last event.
		expect(update({ revs: 101, eventTime: 2048 })).toBe(0);
	});

	it('clamps an absurd rate rather than passing noise on', () => {
		const update = createCadenceTracker(() => 0);
		update({ revs: 0, eventTime: 0 });
		// 50 revolutions inside a single tick — a corrupt packet, not a person.
		expect(update({ revs: 50, eventTime: 1 })).toBe(REVOLUTION.maxRpm);
	});
});
