import { describe, expect, it, vi } from 'vitest';

const hud = vi.hoisted(() => ({ publishHud: vi.fn() }));
vi.mock('$lib/hud/feed', () => hud);

import { SimulatedTrainer } from '$lib/ble/simulated';
import { onRoute } from '$lib/road/compile';
import { climbedM } from '$lib/ride/climbed';
import { homeRoad, homeRoute } from '$lib/ride/home-roads';
import { recordingUpload } from '$lib/ride/save';
import { durationSeconds, flatten } from './engine';
import { byId } from './library';
import { cutSteps, openRoad, riddenWorkout } from './ridden';
import { COUNTDOWN_SECONDS } from './ride-state';
import { withProfile } from './road-workout';
import { createRideSession } from './session.svelte';
import type { Workout } from './types';

const sweetSpot = byId('sweet-spot-2x20')!.workout;
const recovery = byId('recovery-spin')!.workout;

async function onThePassLoop() {
	const route = await homeRoute(homeRoad('intro')!);
	const trainer = new SimulatedTrainer();
	const session = createRideSession({
		trainer,
		workout: withProfile(onRoute(sweetSpot, route), route),
		ftp: 250,
		kg: () => 75,
	});
	await session.start();
	session.tick(COUNTDOWN_SECONDS);
	let s = 0;
	const rideTo = (metres: number) => {
		while (session.road!.m < metres && s < 3 * 3600) {
			session.onSample({ watts: 230, cadence: 90, at: s++ * 1000 });
			session.tick();
		}
	};
	// The page's change: the pick on the road where the dot stands.
	const change = (next: Workout | null) => {
		const on = session.road!;
		const road = { routeId: on.routeId, fromM: on.m, toM: on.toM };
		session.changeWorkout(next ? { ...next, road } : openRoad(road));
	};
	return { route, trainer, session, rideTo, change };
}

// #4257: Jan, mid-ride on a WattRoom loop, could swap workouts only by
// ending the ride, which lost his place on the loop.
describe('a workout changed mid-ride', () => {
	it('starts at its first block where the dot is, and the ride runs on as one', async () => {
		const { session, rideTo, change } = await onThePassLoop();
		rideTo(2000);
		const at = session.road!.m;
		const before = session.recording.length;
		const reached = session.elapsed;
		expect(reached).toBeGreaterThan(0);

		change(recovery);
		expect(session.workout.name).toBe(recovery.name);
		expect(session.elapsed).toBe(0);
		expect(session.info.segmentIndex).toBe(0);
		expect(session.road!.m).toBe(at);
		// The graph is the new workout's; the record is the ride's.
		expect(session.trace).toEqual([]);
		expect(session.recording.length).toBe(before);

		rideTo(4000);
		session.stop();
		const upload = recordingUpload(
			session.ridden,
			session.startedAt,
			session.recording,
			{ borrowed: true },
		);
		expect(upload.workoutName).toBe(`${sweetSpot.name} + ${recovery.name}`);
		// One ride: its seconds and its metres run on through the change.
		const metres = upload.samples.map((x) => x.m!);
		expect(metres[0]).toBeLessThan(10);
		expect(metres.at(-1)!).toBeGreaterThanOrEqual(4000);
		for (let i = 1; i < metres.length; i++)
			expect(metres[i]).toBeGreaterThanOrEqual(metres[i - 1]);
		// The second workout's seconds come after the first's, cut where it was left.
		const clocks = upload.samples.map((x) => x.clock!);
		expect(clocks[before - 1]).toBe(Math.ceil(reached) - 1);
		expect(clocks[before]).toBe(Math.ceil(reached));
		const saved = JSON.parse(upload.workoutJson) as Workout;
		// Each workout as far as it was ridden: the saved one ends with the ride.
		expect(durationSeconds(saved)).toBe(clocks.at(-1)! + 1);
		expect(saved.road).toMatchObject({ routeId: 'intro', fromM: 0 });
		expect(saved.road?.stepEndM).toBeUndefined();
	});

	it('rides the road on at its own grade with none, and takes a workout again', async () => {
		const { session, rideTo, change } = await onThePassLoop();
		rideTo(500);
		change(null);
		expect(session.workout.name).toBe('Free ride');
		// SIM owns the trainer on the road: no target to hold.
		expect(session.info.segment.kind).toBe('road');
		expect(session.target).toBe(0);
		rideTo(1500);
		expect(session.state).not.toBe('done');
		change(recovery);
		expect(session.info.segment.kind).not.toBe('road');
		rideTo(2000);
		session.stop();
		expect(session.ridden.name).toBe(
			`${sweetSpot.name} + Free ride + ${recovery.name}`,
		);
		// The free stretch saves as the seconds it lasted, not six hours.
		const free = flatten(session.ridden).find((x) => x.kind === 'road')!;
		expect(free.seconds).toBeLessThan(600);
	});

	// #4283: with none, the free ride's switch rides the road: Road by its
	// grade in SIM, or Watts, ERG holding the road's watts, in one recording.
	it('rides the road in Watts with none, ERG by the road, and back to Road', async () => {
		const { trainer, session, rideTo, change } = await onThePassLoop();
		rideTo(500);
		change(null);
		expect(session.drive).toBe('grade');
		rideTo(700);
		expect(trainer.mode).toBe('sim');
		const before = session.recording.length;

		session.setDrive('watts');
		rideTo(1200);
		expect(trainer.mode, 'Watts left the trainer in SIM').toBe('erg');
		expect(session.target).toBeGreaterThan(0);
		const erg = trainer.writes.filter((w) => w.op === 'erg').at(-1);
		expect(erg).toMatchObject({ watts: session.target });
		expect(session.roadWatts).toBe(session.target);
		// The guards hold the rider to the road's watts, as a free ride's do:
		// a grind under the cadence floor is released.
		for (let i = 0; i < 20 && !session.spiralActive; i++) {
			session.onSample({ watts: 120, cadence: 30, at: 4e6 + i * 1000 });
			session.tick();
		}
		expect(session.spiralActive, 'Watts never released a grind').toBe(true);
		expect(trainer.mode, 'the release still held ERG').toBe('sim');
		rideTo(session.road!.m + 400);

		session.setDrive('grade');
		rideTo(1400);
		expect(trainer.mode).toBe('sim');
		expect(session.target).toBe(0);
		// One ride throughout: the record runs on, saved as the one free stretch.
		expect(session.recording.length).toBeGreaterThan(before);
		session.stop();
		expect(session.ridden.name).toBe(`${sweetSpot.name} + Free ride`);
	});

	// #4277: with none, the HUD, the TV and the world's light still counted
	// the time left against the six hours the open road may last.
	it('with none reads as a free ride on that road: the ride’s time and no end', async () => {
		const { session, rideTo, change } = await onThePassLoop();
		rideTo(500);
		expect(session.total).toBeGreaterThan(0);
		expect(hud.publishHud.mock.lastCall![0].elapsed).toBeUndefined();
		change(null);
		rideTo(800);
		const ridden = session.live.seconds;
		expect(ridden).toBeGreaterThan(60);
		// The TV's total and the world's progress (`total > 0`): no end to count to.
		expect(session.total).toBe(0);
		// The TV's clock and slot 1's big number: the ride's whole time.
		expect(session.elapsed).toBe(ridden);
		// The HUD: the time ridden in place of the time left.
		expect(hud.publishHud.mock.lastCall![0]).toMatchObject({
			remaining: 0,
			elapsed: ridden,
		});
		// A workout again counts down again.
		change(recovery);
		expect(session.total).toBe(durationSeconds(recovery));
		expect(hud.publishHud.mock.lastCall![0].elapsed).toBeUndefined();
	});

	// #4283: with none, slot 1 is the free ride's, which names the road and
	// the ride's metres climbed, whichever screen draws it.
	it('keeps the road’s name and the ride’s metres climbed through a change to none', async () => {
		const { route, session, rideTo, change } = await onThePassLoop();
		expect(session.road!.name).toBe(route.name);
		rideTo(1000);
		const climbed = session.road!.climbed;
		const from = session.road!.along;
		change(null);
		expect(session.road!.name).toBe(route.name);
		expect(session.road!.climbed).toBe(climbed);
		rideTo(3000);
		const rose = climbedM(route.road, from, session.road!.along);
		expect(rose).toBeGreaterThan(0);
		expect(session.road!.climbed - climbed).toBeCloseTo(rose, 6);
	});

	it('saves a ride on one workout as that workout', async () => {
		const { session, rideTo } = await onThePassLoop();
		rideTo(300);
		session.stop();
		expect(session.ridden).toBe(session.workout);
	});
});

describe('cutting a workout where it was left', () => {
	it('keeps whole reps and cuts the block it was in', () => {
		const steps = cutSteps(
			[
				{ type: 'warmup', seconds: 100, from: 0.5, to: 0.7 },
				{
					type: 'repeat',
					times: 3,
					steps: [
						{ type: 'steady', seconds: 60, target: 1.1 },
						{ type: 'steady', seconds: 40, target: 0.5 },
					],
				},
			],
			100 + 2 * 100 + 30,
		);
		expect(steps).toEqual([
			{ type: 'warmup', seconds: 100, from: 0.5, to: 0.7 },
			{
				type: 'repeat',
				times: 2,
				steps: [
					{ type: 'steady', seconds: 60, target: 1.1 },
					{ type: 'steady', seconds: 40, target: 0.5 },
				],
			},
			{ type: 'steady', seconds: 30, target: 1.1 },
		]);
	});

	it('cuts a ramp at the power it had reached', () => {
		expect(
			cutSteps([{ type: 'ramp', seconds: 100, from: 0.5, to: 1 }], 50),
		).toEqual([{ type: 'ramp', seconds: 50, from: 0.5, to: 0.75 }]);
	});

	it('names every workout, within the name a ride may carry', () => {
		const long = { name: 'x'.repeat(60), steps: [] };
		const name = riddenWorkout([
			{ workout: long, reached: 0 },
			{ workout: long, reached: 0 },
		]).name;
		expect(name.length).toBe(80);
		expect(name.endsWith('…')).toBe(true);
	});
});
