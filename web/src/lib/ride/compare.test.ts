import { describe, expect, it } from 'vitest';
import type { RideRecord } from '$lib/history.svelte';
import { bestOfWorkout, compareRows, curveSentence } from './compare';

const ride = (over: Partial<RideRecord> & { id: string }): RideRecord => ({
	workoutName: 'Sweet Spot 3×12',
	startedAt: '2026-09-01T18:00:00Z',
	seconds: 3600,
	kj: 600,
	avgWatts: 200,
	execution: 0.9,
	ftp: 250,
	...over,
});

describe('bestOfWorkout', () => {
	it('picks the hardest ride of the same workout', () => {
		const best = bestOfWorkout(
			[
				ride({ id: 'a', avgWatts: 209 }),
				ride({ id: 'b', avgWatts: 195 }),
				ride({ id: 'today', avgWatts: 214 }),
			],
			'Sweet Spot 3×12',
			'today',
		);
		expect(best?.id).toBe('a');
	});

	it('never compares a ride to itself', () => {
		expect(
			bestOfWorkout([ride({ id: 'today' })], 'Sweet Spot 3×12', 'today'),
		).toBeNull();
	});

	it('ignores other workouts, so a first ride of one has no best', () => {
		expect(
			bestOfWorkout(
				[ride({ id: 'a', workoutName: 'Threshold 2×20', avgWatts: 300 })],
				'Sweet Spot 3×12',
				'today',
			),
		).toBeNull();
	});
});

describe('compareRows', () => {
	it('signs each delta and leaves an unchanged one blank', () => {
		const rows = compareRows(
			ride({ id: 'today', avgWatts: 214, execution: 0.91, kj: 612 }),
			ride({ id: 'best', avgWatts: 209, execution: 0.88, kj: 612 }),
		);
		expect(rows.map((r) => r.delta)).toEqual(['+5 W', '+3 pt', '']);
	});

	it('states a lighter day as a number, with no verdict attached', () => {
		const rows = compareRows(
			ride({ id: 'today', avgWatts: 195 }),
			ride({ id: 'best', avgWatts: 209 }),
		);
		expect(rows[0].delta).toBe('−14 W');
	});
});

describe('curveSentence', () => {
	// d30 ⊂ d90, so d30 can never exceed d90 — equal means the 90-day best was
	// set inside the last 30 days, which is the good news, not a zero delta.
	it('says the best is recent when the windows agree', () => {
		expect(curveSentence(222, 222)).toContain('set it in the last 30');
	});

	it('names both windows when they differ', () => {
		const out = curveSentence(210, 222);
		expect(out).toContain('222 W across 90 days');
		expect(out).toContain('210 W in the last 30');
	});

	it('says nothing at all without a curve yet', () => {
		expect(curveSentence(0, 0)).toBeNull();
	});
});
