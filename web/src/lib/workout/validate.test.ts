import { describe, expect, it } from 'vitest';
import { library } from './library';
import { LIMITS, validateWorkout } from './validate';

const ok = (steps: unknown[]) => ({ name: 'test', steps });

describe('validateWorkout', () => {
	it('accepts every workout we ship — the library is its own fixture', () => {
		for (const entry of library) {
			const result = validateWorkout(entry.workout);
			expect(result.ok, `${entry.id}: ${result.ok ? '' : result.error}`).toBe(
				true,
			);
		}
	});

	it('rejects things that are not workouts at all', () => {
		for (const value of [null, undefined, 42, 'workout', [], {}]) {
			expect(validateWorkout(value).ok).toBe(false);
		}
	});

	it('requires a name and at least one step', () => {
		expect(
			validateWorkout({ steps: [{ type: 'steady', seconds: 60, target: 0.8 }] })
				.ok,
		).toBe(false);
		expect(validateWorkout({ name: '  ', steps: [] }).ok).toBe(false);
		expect(validateWorkout(ok([])).ok).toBe(false);
	});

	it('rejects unknown step types by name, so the message is useful', () => {
		const result = validateWorkout(ok([{ type: 'interval', seconds: 60 }]));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('interval');
	});

	it('rejects unrideable durations', () => {
		expect(
			validateWorkout(ok([{ type: 'steady', seconds: 1, target: 0.8 }])).ok,
		).toBe(false);
		expect(
			validateWorkout(ok([{ type: 'steady', seconds: 999_999, target: 0.8 }]))
				.ok,
		).toBe(false);
	});

	it('rejects targets outside a plausible range', () => {
		expect(
			validateWorkout(ok([{ type: 'steady', seconds: 60, target: 0 }])).ok,
		).toBe(false);
		expect(
			validateWorkout(ok([{ type: 'steady', seconds: 60, target: 9 }])).ok,
		).toBe(false);
		expect(
			validateWorkout(ok([{ type: 'steady', seconds: 60, target: NaN }])).ok,
		).toBe(false);
	});

	it('accepts absolute watts as an alternative to a fraction', () => {
		expect(
			validateWorkout(ok([{ type: 'steady', seconds: 60, watts: 250 }])).ok,
		).toBe(true);
		expect(
			validateWorkout(ok([{ type: 'steady', seconds: 60, watts: 99_999 }])).ok,
		).toBe(false);
	});

	/**
	 * The reason this file exists. Repeats nest, localStorage is hand-editable, and
	 * flatten() recurses — so a small malicious or corrupted entry could hang the app
	 * or expand into an enormous timeline. Depth and expanded size are both capped.
	 */
	it('rejects repeats nested past the depth limit', () => {
		let step: unknown = { type: 'steady', seconds: 60, target: 0.8 };
		for (let i = 0; i <= LIMITS.maxDepth; i++) {
			step = { type: 'repeat', times: 2, steps: [step] };
		}
		const result = validateWorkout(ok([step]));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('nested');
	});

	it('rejects a small file that expands into an enormous one', () => {
		// 50 × 50 × 1 step = 2500 intervals from three lines of JSON.
		const bomb = {
			type: 'repeat',
			times: 50,
			steps: [
				{
					type: 'repeat',
					times: 50,
					steps: [{ type: 'steady', seconds: 60, target: 0.8 }],
				},
			],
		};
		const result = validateWorkout(ok([bomb]));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('expands');
	});

	it('rejects nonsense repeat counts', () => {
		const inner = [{ type: 'steady', seconds: 60, target: 0.8 }];
		expect(
			validateWorkout(ok([{ type: 'repeat', times: 0, steps: inner }])).ok,
		).toBe(false);
		expect(
			validateWorkout(ok([{ type: 'repeat', times: 2.5, steps: inner }])).ok,
		).toBe(false);
		expect(
			validateWorkout(ok([{ type: 'repeat', times: 3, steps: [] }])).ok,
		).toBe(false);
	});

	it('accepts a sane cadence band and refuses junk (#66)', () => {
		const step = (extra: object) => ({
			type: 'steady',
			seconds: 300,
			target: 0.85,
			...extra,
		});
		expect(
			validateWorkout(ok([step({ cadenceLow: 55, cadenceHigh: 65 })])).ok,
		).toBe(true);
		expect(validateWorkout(ok([step({ cadenceHigh: 60 })])).ok).toBe(true);
		expect(validateWorkout(ok([step({ cadenceLow: 100 })])).ok).toBe(true);
		// Upside down, out of range, or not a number → refused.
		expect(
			validateWorkout(ok([step({ cadenceLow: 90, cadenceHigh: 60 })])).ok,
		).toBe(false);
		expect(validateWorkout(ok([step({ cadenceLow: 200 })])).ok).toBe(false);
		expect(validateWorkout(ok([step({ cadenceHigh: 'fast' })])).ok).toBe(false);
	});

	it('refuses a band whose floor would fight the spiral guard', () => {
		const result = validateWorkout(
			ok([
				{
					type: 'steady',
					seconds: 300,
					target: 0.85,
					cadenceLow: LIMITS.guardTripCadence,
				},
			]),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('spiral guard');
	});

	it('accepts a sane HR band and refuses junk (#67)', () => {
		const step = (extra: object) => ({
			type: 'steady',
			seconds: 300,
			target: 0.65,
			...extra,
		});
		expect(validateWorkout(ok([step({ hrHigh: 145 })])).ok).toBe(true);
		expect(validateWorkout(ok([step({ hrLow: 120, hrHigh: 140 })])).ok).toBe(
			true,
		);
		expect(validateWorkout(ok([step({ hrLow: 160, hrHigh: 120 })])).ok).toBe(
			false,
		);
		expect(validateWorkout(ok([step({ hrHigh: 300 })])).ok).toBe(false);
		expect(validateWorkout(ok([step({ hrLow: 'easy' })])).ok).toBe(false);
	});
});
