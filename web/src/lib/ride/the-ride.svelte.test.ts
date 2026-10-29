// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trainer } from '$lib/ble/trainer';
import type { Workout } from '$lib/workout/types';

const fake = vi.hoisted(() => ({
	state: 'countdown',
	clear: vi.fn(),
}));
vi.mock('$lib/channel/connection.svelte', () => ({
	channelConnection: { current: null },
}));
vi.mock('$lib/profile.svelte', () => ({
	createProfileStore: () => ({ current: { ftp: 200, kg: 75 } }),
}));
vi.mock('$lib/ride/solo-trainer.svelte', () => ({
	soloTrainer: () => ({ trainer: null, forget() {}, adopt() {} }),
}));
vi.mock('$lib/ride/road-alone.svelte', () => ({ holdRoadAlone: vi.fn() }));
vi.mock('$lib/ride/ride-alone-save', () => ({ saveRideAlone: vi.fn() }));
vi.mock('$lib/ride/ride-alone-effects.svelte', () => ({
	holdRideAloneEffects: () => ({
		flags: { riding() {}, flush() {}, recorder: { event() {}, tick() {} } },
		signal: { lost: false },
	}),
}));
vi.mock('$lib/ride/ride-alone-session', () => ({
	openWorkoutBuffer: async () => ({ crashSafe: true, end() {} }),
	createWorkoutAlone: () => ({
		get state() {
			return fake.state;
		},
		async start() {},
	}),
}));
vi.mock('$lib/world/picture.svelte', () => ({
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

	it('lets the last ride’s world picture go at the ride’s start', async () => {
		await theRide.begin(trainer, workout, { borrowed: false });
		expect(fake.clear).toHaveBeenCalledTimes(1);
	});
});
