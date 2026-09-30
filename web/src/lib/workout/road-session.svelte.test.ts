import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/hud/feed', () => ({ publishHud: () => {} }));

import { SimulatedTrainer } from '$lib/ble/simulated';
import { climbsOf } from '$lib/road/climbs';
import { compileRoad } from '$lib/road/compile';
import { packRoad, type Road } from '$lib/road/road';
import { recordingUpload } from '$lib/ride/save';
import { createRideSession } from './session.svelte';
import { COUNTDOWN_SECONDS } from './ride-state';
import type { Workout } from './types';

// A hand-written road, 2 km climbing a steady 2 % (#3054): nobody's route.
const road: Road = {
	length: 2000,
	heights: Array.from({ length: 101 }, (_, i) => 100 + 0.4 * i),
	turns: Array<number>(100).fill(0),
};
const workout: Workout = {
	name: 'Road · 2.0 km',
	steps: [
		{ type: 'steady', seconds: 150, target: 0.7 },
		{ type: 'steady', seconds: 200, target: 0.8 },
	],
	road: {
		routeId: '00000000-0000-0000-0000-000000000001',
		fromM: 0,
		toM: 2000,
		stepEndM: [800, 2000],
		profile: btoa(String.fromCharCode(...packRoad(road))),
		originM: 0,
	},
};
const FTP = 250;

/**
 * Ride the workout to its end, a sample a second at `watts(target)`; the
 * seconds it took, and where each block ended by the clock.
 */
async function rideIt(bias: number, watts: (target: number) => number) {
	const session = createRideSession({
		trainer: new SimulatedTrainer(),
		workout,
		ftp: FTP,
		kg: () => 75,
	});
	await session.start();
	session.tick(COUNTDOWN_SECONDS);
	session.nudgeBias(bias - 1);
	let s = 0;
	let blockTwoAtM: number | null = null;
	for (; s < 3600 && session.state !== 'done'; s++) {
		session.onSample({
			watts: watts(session.target),
			cadence: 85,
			at: s * 1000,
		});
		if (blockTwoAtM === null && session.info.segmentIndex === 1)
			blockTwoAtM = session.road!.m;
		session.tick();
	}
	return { session, seconds: s, blockTwoAtM };
}

describe('the engine rides a road workout (#3499)', () => {
	it('ends a block when the dot reaches its metre, and the ride at the last', async () => {
		const { session, blockTwoAtM } = await rideIt(1, (t) => t);
		expect(blockTwoAtM).toBeGreaterThanOrEqual(800);
		expect(blockTwoAtM! - 800).toBeLessThan(10); // within a second's travel
		expect(session.state).toBe('done');
		expect(session.road!.m).toBeGreaterThanOrEqual(2000 - 10);
		// Nothing to skip to, or hold longer: the road decides.
		const before = session.info.segmentIndex;
		session.skip();
		expect(session.info.segmentIndex).toBe(before);
	});

	it('takes longer over the same metres at a 0.8 bias', async () => {
		const full = await rideIt(1, (t) => t);
		const eased = await rideIt(0.8, (t) => t);
		expect(eased.seconds).toBeGreaterThan(full.seconds * 1.1);
		expect(eased.session.road!.m).toBeGreaterThanOrEqual(2000 - 10);
	});

	it('weights execution by the seconds actually spent in each block', async () => {
		// On target through the first block, half its watts through the second.
		const { session } = await rideIt(1, (t) =>
			t === Math.round(0.8 * FTP) ? t / 2 : t,
		);
		const splitAt = session.segments[1].startSeconds;
		const inOne = session.recording.filter(
			(r) => !r.released && r.clock < splitAt,
		).length;
		const inTwo = session.recording.filter(
			(r) => !r.released && r.clock >= splitAt,
		).length;
		// The slow block took longer, so it weighs more than its 200 s estimate.
		expect(inTwo).toBeGreaterThan(200);
		const expected = (inOne * 0.7) / (inOne * 0.7 + inTwo * 0.8);
		expect(session.execution).toBeCloseTo(expected, 1);
	});

	it('rides what the compiler makes of a route, to its end', async () => {
		const [leg] = compileRoad(
			{
				id: workout.road!.routeId,
				genName: 'Road · 2.0 km',
				road,
				climbs: climbsOf(road),
			},
			FTP,
			75 + 9,
		);
		const compiled: Workout = {
			...leg,
			road: { ...leg.road!, profile: workout.road!.profile, originM: 0 },
		};
		const session = createRideSession({
			trainer: new SimulatedTrainer(),
			workout: compiled,
			ftp: FTP,
			kg: () => 75,
		});
		await session.start();
		session.tick(COUNTDOWN_SECONDS);
		for (let s = 0; s < 3600 && session.state !== 'done'; s++) {
			session.onSample({ watts: session.target, cadence: 85, at: s * 1000 });
			session.tick();
		}
		expect(session.state).toBe('done');
		expect(session.road!.m).toBeGreaterThanOrEqual(leg.road!.toM - 10);
	});

	it('saves against its route, by reference, with its metres', async () => {
		const { session } = await rideIt(1, (t) => t);
		const upload = recordingUpload(
			workout,
			session.startedAt,
			session.recording,
		);
		expect(upload.routeId).toBe(workout.road!.routeId);
		expect(upload.drive).toBe('ergByRoad');
		expect(JSON.parse(upload.workoutJson).road).not.toHaveProperty('profile');
		const ms = upload.samples.map((s) => s.m!);
		for (let i = 1; i < ms.length; i++)
			expect(ms[i]).toBeGreaterThanOrEqual(ms[i - 1]);
	});
});
