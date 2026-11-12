// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trainer } from '#lib/ble/trainer.ts';
import type { Workout } from '#lib/workout/types.ts';

const fake = vi.hoisted(() => ({
	state: 'countdown',
	clear: vi.fn(),
	sent: [] as unknown[],
	workout: null as unknown,
	ask: undefined as undefined | (() => number),
}));
vi.mock('#lib/rider-lane.svelte.ts', () => ({
	riderLane: {
		sendGame: (control: unknown) => void fake.sent.push(control),
		onGame: () => () => {},
	},
}));
vi.mock('#lib/channel/connection.svelte.ts', () => ({
	channelConnection: { current: null },
}));
vi.mock('#lib/profile.svelte.ts', () => ({
	createProfileStore: () => ({ current: { ftp: 200, kg: 75 } }),
}));
vi.mock('#lib/ride/solo-trainer.svelte.ts', () => ({
	soloTrainer: () => ({ trainer: null, forget() {}, adopt() {} }),
}));
vi.mock('#lib/ride/road-alone.svelte.ts', () => ({ holdRoadAlone: vi.fn() }));
vi.mock('#lib/ride/ride-alone-save.ts', () => ({ saveRideAlone: vi.fn() }));
vi.mock('#lib/ride/ride-alone-effects.svelte.ts', () => ({
	holdRideAloneEffects: () => ({
		flags: { riding() {}, flush() {}, recorder: { event() {}, tick() {} } },
		signal: { lost: false },
	}),
}));
vi.mock('#lib/ride/ride-alone-session.ts', () => ({
	openWorkoutBuffer: async () => ({ crashSafe: true, end() {} }),
	createWorkoutAlone: (deps: { workout: unknown; ask?: () => number }) => {
		fake.workout = deps.workout;
		fake.ask = deps.ask;
		return {
			get state() {
				return fake.state;
			},
			sample: { watts: 190 },
			async start() {},
			abort() {},
		};
	},
}));
vi.mock('#lib/world/picture.svelte.ts', () => ({
	worldPicture: { clear: fake.clear },
}));

import { theRide } from './the-ride.svelte';

const trainer = { name: 'Simulated Trainer' } as Trainer;
const workout: Workout = {
	name: 'Leg 1 of 2',
	steps: [{ type: 'steady', seconds: 600, target: 0.6 }],
};

describe('theRide (ADR-0093)', () => {
	beforeEach(() => {
		// The ride before is over, so the next Start is offered.
		fake.state = 'done';
		fake.clear.mockClear();
	});

	it('keeps the way on its setup chose, so a page opened again still offers it', async () => {
		const next = { label: 'Ride leg 2 of 2', href: '/ride?road=r1&leg=2' };
		await theRide.begin(trainer, workout, { borrowed: false, next });
		expect(theRide.next).toEqual(next);

		await theRide.begin(trainer, workout, { borrowed: false });
		expect(theRide.next, 'a ride with no next leg kept the last').toBeNull();
	});

	// #4539: a game picked on the solo ride ran as a session in the rider's
	// crew, started at once. It runs on this ride now: counted in, then
	// started on the rider's own lane, with no request to any crew.
	it('runs a game alone on the ride, after its count-in, never in a crew session', async () => {
		vi.useFakeTimers();
		const fetch = vi.spyOn(globalThis, 'fetch');
		try {
			fake.sent = [];
			await theRide.beginGame(trainer, 'floor-is-lava');
			fake.state = 'countdown';
			expect(theRide.game?.mode).toBe('floor-is-lava');
			expect(fake.workout).toMatchObject({
				name: 'Floor is Lava',
				unscored: true,
			});
			vi.advanceTimersByTime(3000);
			expect(fake.sent, 'the game started before the count-in ended').toEqual(
				[],
			);

			fake.state = 'running';
			vi.advanceTimersByTime(1000);
			expect(fake.sent).toEqual([
				expect.objectContaining({ action: 'start', mode: 'floor-is-lava' }),
			]);
			expect(fake.ask?.()).toBe(0);
			expect(fetch, 'the game reached for a crew').not.toHaveBeenCalled();

			// End game leaves the ride riding.
			theRide.endGame();
			expect(fake.sent.at(-1)).toMatchObject({ action: 'end' });
			expect(theRide.game).toBeNull();
			expect(theRide.session?.state).toBe('running');
		} finally {
			theRide.cancelCountdown();
			fetch.mockRestore();
			vi.useRealTimers();
		}
	});

	it('lets the last ride’s world picture go at the ride’s start', async () => {
		await theRide.begin(trainer, workout, { borrowed: false });
		expect(fake.clear).toHaveBeenCalledTimes(1);
	});
});
