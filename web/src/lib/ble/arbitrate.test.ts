import { describe, expect, it } from 'vitest';
import { arbitrate, ARBITRATION } from './arbitrate';

const NOW = 1_000_000;
const trainer = (
	over: Partial<{
		watts: number;
		cadence: number;
		heartRate: number;
		at: number;
	}> = {},
) => ({
	watts: 200,
	cadence: 85,
	at: NOW,
	...over,
});

describe('arbitrate', () => {
	it('falls back to the trainer when nothing else is paired', () => {
		const m = arbitrate({ trainer: trainer(), sensors: {} }, NOW);
		expect(m).toMatchObject({ watts: 200, cadence: 85 });
		expect(m.from).toEqual({ watts: 'trainer', cadence: 'trainer' });
	});

	it('lets a power meter beat the trainer on power', () => {
		const m = arbitrate(
			{
				trainer: trainer(),
				sensors: { 'power-meter': { watts: 213, at: NOW } },
			},
			NOW,
		);
		expect(m.watts).toBe(213);
		expect(m.from.watts).toBe('power-meter');
	});

	it('ranks cadence sensor over meter crank over trainer estimate', () => {
		const sensors = {
			'power-meter': { watts: 213, cadence: 88, at: NOW },
			cadence: { cadence: 90, at: NOW },
		};
		expect(arbitrate({ trainer: trainer(), sensors }, NOW).from.cadence).toBe(
			'cadence',
		);

		const withoutSensor = { 'power-meter': sensors['power-meter'] };
		expect(
			arbitrate({ trainer: trainer(), sensors: withoutSensor }, NOW).from
				.cadence,
		).toBe('power-meter');

		expect(
			arbitrate({ trainer: trainer(), sensors: {} }, NOW).from.cadence,
		).toBe('trainer');
	});

	it('treats a reported zero as a reading, not a missing source', () => {
		// The rider stopped pedalling. Auto-pause depends on this being 0 from the
		// cadence sensor rather than falling through to the trainer's estimate.
		const m = arbitrate(
			{
				trainer: trainer({ cadence: 40 }),
				sensors: { cadence: { cadence: 0, at: NOW } },
			},
			NOW,
		);
		expect(m.cadence).toBe(0);
		expect(m.from.cadence).toBe('cadence');
	});

	it('prefers a directly-paired strap over trainer-relayed HR', () => {
		const m = arbitrate(
			{
				trainer: trainer({ heartRate: 140 }),
				sensors: { 'heart-rate': { heartRate: 152, at: NOW } },
			},
			NOW,
		);
		expect(m.heartRate).toBe(152);
		expect(m.from.heartRate).toBe('heart-rate');
	});

	it('uses trainer-relayed HR when no strap is paired to us', () => {
		const m = arbitrate(
			{ trainer: trainer({ heartRate: 140 }), sensors: {} },
			NOW,
		);
		expect(m.heartRate).toBe(140);
		expect(m.from.heartRate).toBe('trainer');
	});

	it('leaves heart rate undefined when nothing reports it', () => {
		const m = arbitrate({ trainer: trainer(), sensors: {} }, NOW);
		expect(m.heartRate).toBeUndefined();
		expect(m.from.heartRate).toBeUndefined();
	});

	it('drops a stale source rather than showing its last value forever', () => {
		// The strap went out of range; the meter is still reporting.
		const stale = NOW - ARBITRATION.staleMs - 1;
		const m = arbitrate(
			{
				trainer: trainer(),
				sensors: {
					'power-meter': { watts: 213, at: stale },
					'heart-rate': { heartRate: 152, at: stale },
				},
			},
			NOW,
		);
		expect(m.watts).toBe(200);
		expect(m.from.watts).toBe('trainer');
		expect(m.heartRate).toBeUndefined();
	});
});
