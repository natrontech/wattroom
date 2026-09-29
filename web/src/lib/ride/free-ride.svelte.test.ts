import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploads: unknown[] = [];
let offline = false;
vi.mock('$lib/ride/save', () => ({
	uploadRide: vi.fn(async (ride: unknown) => {
		uploads.push(ride);
		if (offline)
			return { failure: { message: 'You are offline.', final: false } };
		return { saved: { id: 'r1' } };
	}),
}));
const ended: string[] = [];
vi.mock('$lib/ride/buffer', () => ({
	openRideBuffer: vi.fn(async () => ({
		crashSafe: true,
		append() {},
		end: () => void ended.push('end'),
		release: () => void ended.push('release'),
		since: async () => [],
	})),
}));

import { ergByRoad } from './ride-grade';
import type { RideableRoute } from './roads';
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

describe('where a free ride opens (#3203)', () => {
	// A one-gear setup (Zwift Cog) has no usable slope, so it opens in watts.
	it.each([
		{ singleSpeed: undefined, opens: 'grade' },
		{ singleSpeed: false, opens: 'grade' },
		{ singleSpeed: true, opens: 'watts' },
	] as const)(
		'singleSpeed $singleSpeed opens in $opens',
		({ singleSpeed, opens }) => {
			const free = createFreeRide({
				ftp: () => 200,
				singleSpeed: singleSpeed === undefined ? undefined : () => singleSpeed,
			});
			expect(free.mode).toBe(opens);
			expect(free.watts).toBe(openingWatts(200));
		},
	);

	it('keeps grade one tap away on one gear, and the pick sticks', () => {
		const free = createFreeRide({ ftp: () => 200, singleSpeed: () => true });
		free.setMode('grade');
		expect(free.mode).toBe('grade');
		free.nudge(1);
		expect(free.grade).toBe(0.5);
	});

	it('follows a profile that arrives after the connection did', () => {
		let singleSpeed = false;
		const free = createFreeRide({
			ftp: () => 200,
			singleSpeed: () => singleSpeed,
		});
		expect(free.mode).toBe('grade');
		singleSpeed = true;
		expect(free.mode).toBe('watts');
	});
});

describe('recording a free ride', () => {
	beforeEach(() => {
		uploads.length = 0;
		ended.length = 0;
		offline = false;
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

	// #3056: on a road, a descent coasted at 0 W is ridden, and counts.
	it('counts a coasted second on a road, and uploads none of its speed', async () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		free.second(pedal);
		free.second({ watts: 0, cadence: 0, hr: 110, virtualMps: 9 });
		free.second({ watts: 0, cadence: 0, hr: 110, virtualMps: 0.4 });
		expect(free.seconds).toBe(2);
		for (let i = 0; i < 60; i++)
			free.second({ watts: 0, cadence: 0, hr: 110, virtualMps: 12 });
		expect(await free.end()).toEqual({ saved: { id: 'r1' } });
		// The server's decoder refuses a field it does not know.
		for (const sample of (uploads[0] as { samples: object[] }).samples)
			expect(Object.keys(sample).sort()).toEqual(['cadence', 'hr', 'watts']);
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

	// Not saved and no longer recorded: the buffer lets go of it so the
	// recovery card offers it back, and does not mark it finished (#2617).
	it('lets go of a ride whose save failed, without ending it', async () => {
		offline = true;
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		free.second(pedal);
		await vi.waitFor(() => expect(free.recording).toBe(true));
		await new Promise((resolve) => setTimeout(resolve, 0));
		for (let i = 1; i < 60; i++) free.second(pedal);
		await free.end();
		expect(ended).toEqual(['release']);
	});

	it('lets a ride under a minute go instead of saving it', async () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		for (let i = 0; i < 59; i++) free.second(pedal);
		expect(await free.end()).toEqual({ short: true });
		expect(uploads).toHaveLength(0);
	});
});

// #3027: the road is an attribute of the free ride. A hand-written road,
// 2 km at a steady 4 % — nobody's real route (#3054).
describe('a free ride on a road', () => {
	beforeEach(() => {
		uploads.length = 0;
		ended.length = 0;
		offline = false;
	});
	const climb: RideableRoute = {
		id: 'route-1',
		name: 'Test climb',
		road: {
			length: 2000,
			heights: Array.from({ length: 101 }, (_, i) => 100 + 0.8 * i),
			turns: Array<number>(100).fill(0),
		},
	};
	/** `seconds` of `watts`, one sample a second from `t0`. */
	function ride(
		free: ReturnType<typeof createFreeRide>,
		watts: number,
		seconds: number,
		t0 = 1_000_000,
	) {
		for (let s = 0; s < seconds; s++)
			free.second({ watts, cadence: 85, hr: 120, at: t0 + s * 1000 });
	}

	it('moves along the road, and saves against the route with its metres', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride(climb);
		expect(free.road).toMatchObject({ id: 'route-1', m: 0 });
		expect(free.road!.roadPct).toBeCloseTo(4, 9);
		ride(free, 250, 90);
		expect(free.road!.m).toBeGreaterThan(200);
		expect(free.road!.felt).toBeCloseTo(2, 6); // half of 4 %, felt (SPEC)
		expect(await free.end()).toEqual({ saved: { id: 'r1' } });
		const saved = uploads[0] as {
			routeId: string;
			drive: string;
			samples: { m: number; alt: number }[];
		};
		expect(saved.routeId).toBe('route-1');
		expect(['sim', 'gears']).toContain(saved.drive);
		expect(saved.samples).toHaveLength(90);
		const last = saved.samples.at(-1)!;
		expect(last.m).toBeCloseTo(free.road!.m, 6);
		expect(last.alt).toBeCloseTo(100 + (last.m / 20) * 0.8, 6);
		// Forward only, as the server's bound holds it.
		for (let i = 1; i < saved.samples.length; i++)
			expect(saved.samples[i].m).toBeGreaterThanOrEqual(saved.samples[i - 1].m);
	});

	it('holds ERG by the road in watts mode, and says so in the save', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.setMode('watts');
		free.ride(climb);
		expect(free.targetWatts).toBe(ergByRoad(250, 4));
		ride(free, 200, 61);
		await free.end();
		expect((uploads[0] as { drive: string }).drive).toBe('ergByRoad');
	});

	it('keeps its road once the ride has started', () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride(climb);
		ride(free, 200, 3);
		free.leaveRoad();
		expect(free.road?.id).toBe('route-1');
		free.ride({ ...climb, id: 'route-2' });
		expect(free.road?.id).toBe('route-1');
	});

	it('uploads no road at all off one', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		ride(free, 200, 61);
		await free.end();
		const saved = uploads[0] as Record<string, unknown> & {
			samples: object[];
		};
		expect(saved.routeId).toBeUndefined();
		expect(saved.drive).toBeUndefined();
		expect(Object.keys(saved.samples[0]).sort()).toEqual([
			'cadence',
			'hr',
			'watts',
		]);
	});
});
