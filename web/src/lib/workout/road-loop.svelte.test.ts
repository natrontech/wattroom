import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/hud/feed', () => ({ publishHud: () => {} }));

import { SimulatedTrainer } from '$lib/ble/simulated';
import { onRoute } from '$lib/road/compile';
import type { Road } from '$lib/road/road';
import { homeRoad, homeRoute } from '$lib/ride/home-roads';
import { recordingUpload } from '$lib/ride/save';
import { createRideSession } from './session.svelte';
import { COUNTDOWN_SECONDS } from './ride-state';
import { byId } from './library';
import { withProfile } from './road-workout';

/** Metres the samples rode, lap by lap, as the server's replay sums them (#3598). */
function riddenM(samples: { m?: number; lap?: number }[]): number {
	const laps = new Map<number, number[]>();
	for (const s of samples) {
		if (s.m === undefined) continue;
		const ms = laps.get(s.lap ?? 0) ?? [];
		ms.push(s.m);
		laps.set(s.lap ?? 0, ms);
	}
	let sum = 0;
	for (const ms of laps.values()) sum += Math.abs(ms.at(-1)! - ms[0]);
	return sum;
}

// #4261: Sweet Spot 2×20 in ERG on a WattRoom loop stopped dead at the end of
// its first lap, the workout still running.
describe('a workout on a loop', () => {
	it('rides 65 min of ERG at 180 W on the Valley loop past one lap, never stopping', async () => {
		const route = await homeRoute(homeRoad('valley')!);
		const workout = withProfile(
			onRoute(byId('sweet-spot-2x20')!.workout, route),
			route,
		);
		const session = createRideSession({
			trainer: new SimulatedTrainer(),
			workout,
			ftp: 200,
			kg: () => 75,
		});
		await session.start();
		session.tick(COUNTDOWN_SECONDS);
		let stopped = 0;
		for (let s = 0; s < 65 * 60 && session.state !== 'done'; s++) {
			session.onSample({ watts: 180, cadence: 90, at: s * 1000 });
			if (s > 60 && session.road!.mps === 0) stopped++;
			session.tick();
		}
		expect(session.state).toBe('done');
		expect(stopped).toBe(0);
		const upload = recordingUpload(
			workout,
			session.startedAt,
			session.recording,
		);
		expect(riddenM(upload.samples)).toBeGreaterThan(route.road.length * 1.3);
		// The next lap starts on the line, in the same direction (#3598).
		const laps = new Set(upload.samples.map((s) => s.lap ?? 0));
		expect(laps).toEqual(new Set([0, 1]));
		expect(upload.samples.some((s) => s.reverse)).toBe(false);
	});
});

describe('a workout that outlasts an open road', () => {
	// 2 km up a steady 2 %, nobody's route; ten minutes of riding outlast it.
	const road: Road = {
		length: 2000,
		heights: Array.from({ length: 101 }, (_, i) => 100 + 0.4 * i),
		turns: Array<number>(100).fill(0),
	};
	const workout = withProfile(
		onRoute(
			{ name: 'Ten', steps: [{ type: 'steady', seconds: 600, target: 0.9 }] },
			{ id: '00000000-0000-0000-0000-000000000001', road },
		),
		{ road },
	);

	it('turns at each end and rides on while the workout runs', async () => {
		const session = createRideSession({
			trainer: new SimulatedTrainer(),
			workout,
			ftp: 250,
			kg: () => 75,
		});
		await session.start();
		session.tick(COUNTDOWN_SECONDS);
		// Where the dot stood still: a turn rides off from standstill, as a
		// free ride's does (#3205).
		const stood: number[] = [];
		for (let s = 0; s < 600 && session.state !== 'done'; s++) {
			session.onSample({ watts: 225, cadence: 90, at: s * 1000 });
			if (s > 30 && session.road!.mps === 0) stood.push(session.road!.m);
			session.tick();
		}
		expect(session.state).toBe('done');
		expect(stood).toEqual([2000, 0]);
		const samples = recordingUpload(
			workout,
			session.startedAt,
			session.recording,
		).samples;
		const back = samples.findIndex((s) => s.lap === 1);
		const on = samples.findIndex((s) => s.lap === 2);
		expect(samples[back]).toMatchObject({ m: 2000, reverse: true });
		expect(samples[on].m).toBe(0);
		expect(samples[on].reverse).toBeUndefined();
		for (let i = back + 1; i < on; i++)
			expect(samples[i].m!).toBeLessThanOrEqual(samples[i - 1].m!);
		for (let i = on + 1; i < samples.length; i++)
			expect(samples[i].m!).toBeGreaterThanOrEqual(samples[i - 1].m!);
		expect(riddenM(samples)).toBeGreaterThan(2 * 2000);
	});
});
