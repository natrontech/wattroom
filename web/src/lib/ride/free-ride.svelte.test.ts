import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploads: unknown[] = [];
vi.mock('$lib/ride/save', () => ({
	uploadRide: vi.fn(async (ride: unknown) => {
		uploads.push(ride);
		return { saved: { id: 'r1' } };
	}),
}));
const ended: string[] = [];
vi.mock('$lib/ride/buffer', () => ({
	MIN_SAMPLES: 60,
	openRideBuffer: vi.fn(async () => ({
		crashSafe: true,
		append() {},
		end: () => void ended.push('end'),
		since: async () => [],
	})),
}));

import {
	createFreeRide,
	FREE_RIDE_JSON,
	nudged,
	openingWatts,
} from './free-ride.svelte';

describe('the free ride’s control (docs/SPEC.md)', () => {
	it('opens watts at 55 % of FTP on the 10 W grid', () => {
		expect(openingWatts(250)).toBe(140);
		expect(openingWatts(40)).toBe(50);
	});

	it('steps and holds its bounds', () => {
		expect(nudged('grade', 0, 1)).toBe(0.5);
		expect(nudged('grade', 15, 1)).toBe(15);
		expect(nudged('grade', -5, -1)).toBe(-5);
		expect(nudged('watts', 140, -1)).toBe(130);
		expect(nudged('watts', 1000, 1)).toBe(1000);
	});
});

describe('recording a free ride', () => {
	beforeEach(() => {
		uploads.length = 0;
		ended.length = 0;
	});
	const pedal = { watts: 150, cadence: 90, hr: 120 };

	it('records nothing until the surface arms it — a warm-up is not a ride', () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.second(pedal);
		expect(free.recording).toBe(false);
		free.arm();
		free.second(pedal);
		expect(free.recording).toBe(true);
		expect(free.seconds).toBe(1);
	});

	it('counts only the seconds you pedal', () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		free.second(pedal);
		free.second({ watts: 0, cadence: 0, hr: 110 });
		free.second(pedal);
		expect(free.seconds).toBe(2);
	});

	it('saves as the empty, unscored workout named Free ride', async () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		for (let i = 0; i < 60; i++) free.second(pedal);
		expect(await free.end()).toEqual({ saved: { id: 'r1' } });
		expect(uploads).toHaveLength(1);
		expect(uploads[0]).toMatchObject({
			workoutName: 'Free ride',
			workoutJson: FREE_RIDE_JSON,
		});
		expect(JSON.parse(FREE_RIDE_JSON)).toEqual({
			name: 'Free ride',
			unscored: true,
			steps: [],
		});
		expect(free.armed).toBe(false);
		expect(free.recording).toBe(false);
	});

	it('lets a ride under a minute go instead of saving it', async () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		for (let i = 0; i < 59; i++) free.second(pedal);
		expect(await free.end()).toEqual({ short: true });
		expect(uploads).toHaveLength(0);
	});
});
