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

const cues: { id: string; semitones?: number }[] = [];
vi.mock('$lib/sound/cues', () => ({
	play: (id: string, o?: { semitones?: number }) =>
		void cues.push({ id, semitones: o?.semitones }),
}));

import { RAMP, rampWatts } from './free-ride-controls';
import { createFreeRide } from './free-ride.svelte';

type Ride = ReturnType<typeof createFreeRide>;
const pedal = (free: Ride, seconds: number) => {
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

	it('cues its start and end, and says it is done for a while', () => {
		cues.length = 0;
		const free = createFreeRide({ ftp: () => 250 });
		free.arm();
		free.startRamp('warmup', 5);
		pedal(free, 300);
		expect(cues).toEqual([
			{ id: 'block', semitones: undefined },
			{ id: 'block', semitones: -5 },
		]);
		expect(free.rampDone).toBe('warmup');
		pedal(free, RAMP.doneSeconds);
		expect(free.rampDone).toBeNull();
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
		{ act: 'a + tap', from: 'watts', run: (f: Ride) => f.nudge(1), held: 150 },
		{ act: 'a + tap', from: 'grade', run: (f: Ride) => f.nudge(1), held: 150 },
		{ act: 'Stop', from: 'watts', run: (f: Ride) => f.stopRamp(), held: 140 },
		{ act: 'Stop', from: 'grade', run: (f: Ride) => f.stopRamp(), held: 140 },
	] as const)(
		'$act from $from ends the ramp, holding $held W in watts',
		({ from, run, held }) => {
			const free = createFreeRide({ ftp: () => 250 });
			free.arm();
			free.setMode(from);
			free.startRamp('warmup', 5);
			pedal(free, 150);
			run(free);
			expect(free.ramp).toBeNull();
			expect(free.mode).toBe('watts');
			expect(free.targetWatts).toBe(held);
			pedal(free, 60);
			expect(free.targetWatts).toBe(held);
		},
	);

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
