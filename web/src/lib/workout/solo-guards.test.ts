import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS, riding, type GuardSample } from './guards';
import { createRideRecord } from './ride-record.svelte';
import { createRiderGuards } from './rider-guards.svelte';
import type { RideState } from './ride-state';
import { wireSoloGuards } from './solo-guards';

/**
 * #3056 (docs/SPEC.md "Riding on a road"): on a road, virtual speed above
 * 0.5 m/s is riding. A descent coasted at 0 W is a rider on their bike, not
 * one who got off: auto-pause never fires and the ride never ends itself.
 * Off a road nothing changes.
 */
describe('auto-pause and auto-end on a road (#3056)', () => {
	/** `seconds` of one sample a second, as a solo ride feeds them. */
	function ride(sample: GuardSample, seconds: number) {
		const guards = createRiderGuards();
		const end = vi.fn();
		let ended = false;
		const state = (): RideState => (ended ? 'done' : guards.phase);
		const wired = wireSoloGuards(guards, {
			state,
			prescribed: () => 0,
			actuate: () => {},
			record: { trimStoppedTail: () => {} },
			end: () => {
				ended = true;
				end();
			},
		});
		let pausedAt: number | null = null;
		for (let s = 0; s < seconds && !ended; s++) {
			wired.sample(sample, true);
			if (pausedAt === null && guards.phase === 'autopaused') pausedAt = s;
			wired.tick(1);
		}
		return { pausedAt, ended: end.mock.calls.length > 0 };
	}

	const TEN_MINUTES = 600;
	const coasting = { watts: 0, cadence: 0 };

	it.each([
		{
			what: 'a 10-minute descent coasted at 12 m/s, 0 W',
			sample: { ...coasting, virtualMps: 12 },
			pausedAt: null,
			ended: false,
		},
		{
			what: 'rolling just above the line, 0.6 m/s',
			sample: { ...coasting, virtualMps: 0.6 },
			pausedAt: null,
			ended: false,
		},
		{
			what: 'rolling to a halt on a road, 0.4 m/s',
			sample: { ...coasting, virtualMps: 0.4 },
			pausedAt: DEFAULTS.pauseAfterSeconds - 1,
			ended: true,
		},
		{
			what: 'the same stillness off a road, unchanged',
			sample: coasting,
			pausedAt: DEFAULTS.pauseAfterSeconds - 1,
			ended: true,
		},
	])('$what', ({ sample, pausedAt, ended }) => {
		const got = ride(sample, TEN_MINUTES + DEFAULTS.pauseAfterSeconds + 5);
		expect(got.pausedAt).toBe(pausedAt);
		expect(got.ended).toBe(ended);
	});
});

describe('the stopped tail a ride that ended itself trims (#2622, #3056)', () => {
	it('cuts the stop and keeps the descent coasted before it', () => {
		const record = createRideRecord(200);
		let at = 0;
		const add = (sample: GuardSample, seconds: number) => {
			for (let i = 0; i < seconds; i++, at += 1000)
				record.add(at, at / 1000, sample, 1, false);
		};
		add({ watts: 180, cadence: 85 }, 60);
		add({ watts: 0, cadence: 0, virtualMps: 14 }, 120);
		add({ watts: 0, cadence: 0, virtualMps: 0 }, 30);
		record.trimStoppedTail(riding);
		expect(record.recording).toHaveLength(180);
		expect(record.recording.at(-1)?.virtualMps).toBe(14);
	});
});
