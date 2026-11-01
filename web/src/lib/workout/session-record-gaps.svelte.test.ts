import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/hud/feed', () => ({ publishHud: () => {} }));
import { SimulatedTrainer } from '$lib/ble/simulated';
import { MaxBridgedGap } from '$lib/protocol';
import { createRideSession } from './session.svelte';
import { COUNTDOWN_SECONDS } from './ride-state';
import type { Workout } from './types';

const SECONDS = 70 * 60;
const seventy: Workout = {
	name: 'seventy',
	steps: [{ type: 'steady', seconds: SECONDS, target: 0.7 }],
};

/**
 * A 70-minute workout on a trainer that notifies every `periodMs`, each
 * notification a little late. The ride's clock ticks once a wall second, as
 * the ticker does; the record admits one sample per wall second. Returns what
 * the record kept.
 */
async function rideSeventy(
	periodMs: number,
	silences: number[] = [],
	phaseMs = 0,
) {
	const session = createRideSession({
		trainer: new SimulatedTrainer(),
		workout: seventy,
		ftp: 200,
		readings: () => ({}),
	});
	await session.start();
	session.tick(COUNTDOWN_SECONDS);
	const base = 1_000_000_000 + phaseMs;
	let next = periodMs;
	for (let second = 0; second < SECONDS; second++) {
		const until = (second + 1) * 1000;
		while (next < until) {
			if (!silences.some((s) => Math.floor(next / 1000) === s))
				session.onSample({ watts: 140, cadence: 90, at: base + next });
			next += periodMs;
		}
		session.tick();
	}
	return session;
}

describe('a ride alone keeps its length (#4316)', () => {
	it.each([980, 1000, 1030, 1050])(
		'a trainer notifying every %d ms',
		async (periodMs) => {
			const session = await rideSeventy(periodMs);
			expect(session.state).toBe('done');
			expect(SECONDS - session.recording.length).toBeLessThanOrEqual(3);
		},
	);

	// The ticker's phase against the epoch second is arbitrary on a real device.
	it.each([137, 500, 863])(
		'whatever the ticker phase (%d ms)',
		async (phaseMs) => {
			const session = await rideSeventy(1040, [], phaseMs);
			expect(SECONDS - session.recording.length).toBeLessThanOrEqual(3);
		},
	);

	it('keeps a dropout a gap', async () => {
		const dropout = [
			1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009,
		];
		const session = await rideSeventy(1000, dropout);
		expect(SECONDS - session.recording.length).toBeGreaterThanOrEqual(10);
		expect(MaxBridgedGap).toBeLessThan(dropout.length);
	});
});
