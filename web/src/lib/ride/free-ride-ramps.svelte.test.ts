import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/ride/buffer', () => ({
	openRideBuffer: vi.fn(async () => ({
		crashSafe: true,
		append() {},
		end() {},
		release() {},
		since: async () => [],
	})),
}));

import { rampWatts } from './free-ride-controls';
import { createFreeRide } from './free-ride.svelte';

const pedal = (free: ReturnType<typeof createFreeRide>, seconds: number) => {
	for (let i = 0; i < seconds; i++)
		free.second({ watts: 150, cadence: 90, hr: 0 });
};

describe('a ramp’s target (docs/SPEC.md, #4100)', () => {
	const warmup = { from: 0.4 * 250, to: 0.7 * 250, seconds: 300 };
	it.each([
		{ t: 0, watts: 100 },
		{ t: 150, watts: 140 },
		{ t: 299, watts: 170 },
		{ t: 300, watts: 180 },
		{ t: 900, watts: 180 },
	])('$t s in holds $watts W, on the 10 W grid', ({ t, watts }) => {
		expect(rampWatts(warmup, t)).toBe(watts);
	});
});

describe('a free ride’s warm-up and cool-down (#4100)', () => {
	it('warms up in ERG, then carries on in watts at its last target', () => {
		const free = createFreeRide({ ftp: () => 250 });
		free.arm();
		free.setMode('watts');
		free.startRamp('warmup', 5);
		expect(free.mode).toBe('watts');
		expect(free.targetWatts).toBe(100);
		pedal(free, 150);
		expect(free.targetWatts).toBe(140);
		expect(free.ramp).toEqual({ kind: 'warmup', target: 140, left: 150 });
		pedal(free, 150);
		expect(free.ramp).toBeNull();
		expect(free.mode).toBe('watts');
		expect(free.targetWatts).toBe(180);
	});

	it('hands a grade ride back to the grade it left', () => {
		const free = createFreeRide({ ftp: () => 250 });
		free.arm();
		free.nudge(1);
		free.startRamp('warmup', 5);
		expect(free.mode).toBe('watts');
		pedal(free, 300);
		expect(free.mode).toBe('grade');
		expect(free.grade).toBe(0.5);
	});

	it('cools down from the watts held to the floor, and never ends the ride', () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		free.setMode('watts');
		for (let i = 0; i < 10; i++) free.nudge(1);
		expect(free.watts).toBe(210);
		free.startRamp('cooldown', 10);
		expect(free.targetWatts).toBe(210);
		pedal(free, 600);
		expect(free.ramp).toBeNull();
		expect(free.targetWatts).toBe(70);
		expect(free.armed).toBe(true);
	});

	it('cools a grade ride down from the last second’s watts', () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		pedal(free, 1);
		free.startRamp('cooldown', 5);
		expect(free.targetWatts).toBe(150);
	});

	it.each([
		{
			act: 'a nudge',
			run: (f: ReturnType<typeof createFreeRide>) => f.nudge(1),
		},
		{
			act: 'Stop',
			run: (f: ReturnType<typeof createFreeRide>) => f.stopRamp(),
		},
	])('$act ends the ramp at its current target', ({ run }) => {
		const free = createFreeRide({ ftp: () => 250 });
		free.arm();
		free.setMode('watts');
		free.startRamp('warmup', 5);
		pedal(free, 150);
		run(free);
		expect(free.ramp).toBeNull();
		expect(free.targetWatts).toBe(140);
		pedal(free, 60);
		expect(free.targetWatts).toBe(140);
	});

	it('a mode switch ends the ramp and takes the picked mode', () => {
		const free = createFreeRide({ ftp: () => 250 });
		free.arm();
		free.setMode('watts');
		free.startRamp('warmup', 5);
		free.setMode('grade');
		expect(free.ramp).toBeNull();
		expect(free.mode).toBe('grade');
	});
});
