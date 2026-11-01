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
// A production rider (#3333): no dev build and no dev sign-in door, which
// is where gears used to stop.
vi.mock('$lib/ble/can-simulate', () => ({ canSimulate: () => false }));
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

import { MaxRoadSpeedMps } from '$lib/protocol';
import { ergByRoad } from './ride-grade';
import type { RideableRoute } from './roads';
import { nudged, openingWatts, ownRoad } from './free-ride-controls';
import { createFreeRide, FREE_RIDE_JSON } from './free-ride.svelte';
import { roadEndOffered } from './road-end';

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
	it("keeps grade one tap away on Don't make me shift, and the pick sticks", () => {
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

	// #4316: a reading that lands a second late leaves the one before it empty;
	// a short silence is drawn between its two readings, a stop or a long one is not.
	it('keeps its length when one reading lands a second late', async () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		const at = (second: number) => second * 1000;
		free.second({ watts: 100, cadence: 80, hr: 120, at: at(1000) });
		free.second({ watts: 200, cadence: 90, hr: 0, at: at(1002) });
		expect(free.seconds).toBe(3);
		for (let second = 1003; second < 1062; second++)
			free.second({ watts: 200, cadence: 90, hr: 0, at: at(second) });
		expect(await free.end()).toEqual({ saved: { id: 'r1' } });
		const samples = (
			uploads[0] as {
				samples: { watts: number; cadence: number; hr: number }[];
			}
		).samples;
		expect(samples.length).toBe(62);
		expect(samples[1]).toEqual({ watts: 150, cadence: 85, hr: 0 });
	});

	it('bridges neither a stop nor a long silence', () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		free.second({ ...pedal, at: 1_000_000 });
		free.second({ watts: 0, cadence: 0, hr: 110, at: 1_001_000 });
		free.second({ ...pedal, at: 1_003_000 });
		expect(free.seconds).toBe(2);
		free.second({ ...pedal, at: 1_008_000 });
		expect(free.seconds).toBe(3);
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

	// The closing card draws the ride that ended (#3686): its samples
	// outlive the end, until the next ride starts.
	it('keeps what the ended ride rode, for its closing card', async () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		for (let i = 0; i < 60; i++) free.second(pedal);
		await free.end();
		expect(free.ridden).toHaveLength(60);
		expect(free.ridden[0]).toMatchObject({ watts: pedal.watts });
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

	// #3762: the card after End ride reads what was ridden, not 0:00.
	it('keeps the time it ended on, saved or let go', async () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		for (let i = 0; i < 59; i++) free.second(pedal);
		await free.end();
		expect(free.recording).toBe(false);
		expect(free.seconds).toBe(59);
		free.arm();
		for (let i = 0; i < 60; i++) free.second(pedal);
		await free.end();
		expect(free.seconds).toBe(60);
	});

	it('starts the next ride on a clock of its own', async () => {
		const free = createFreeRide({ ftp: () => 200 });
		free.arm();
		for (let i = 0; i < 60; i++) free.second(pedal);
		await free.end();
		free.arm();
		expect(free.seconds).toBe(0);
		free.second(pedal);
		expect(free.seconds).toBe(1);
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

	// "Don't make me shift" × where the ride opens (#3333): without it, grade
	// with gears for every rider; with it, watts, ERG by the road, untimed.
	it.each([
		{ dontShift: undefined, opens: 'grade', drive: 'gears' },
		{ dontShift: false, opens: 'grade', drive: 'gears' },
		{ dontShift: true, opens: 'watts', drive: 'ergByRoad' },
	] as const)(
		"Don't make me shift $dontShift opens in $opens and saves its road by $drive",
		async ({ dontShift, opens, drive }) => {
			const free = createFreeRide({
				ftp: () => 250,
				kg: () => 75,
				singleSpeed: dontShift === undefined ? undefined : () => dontShift,
			});
			expect(free.mode).toBe(opens);
			expect(free.watts).toBe(openingWatts(250));
			free.arm();
			free.ride(climb);
			ride(free, 200, 61);
			expect(await free.end()).toEqual({ saved: { id: 'r1' } });
			expect(uploads[0]).toMatchObject({ routeId: 'route-1', drive });
		},
	);

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
		expect(saved.drive).toBe('gears');
		expect(saved.samples).toHaveLength(90);
		// A sample keeps where its second began, as the server's replay steps
		// it (#3615): a ride from km 0 starts at 0, and the last is a second
		// behind the dot.
		expect(saved.samples[0].m).toBe(0);
		const last = saved.samples.at(-1)!;
		expect(last.m).toBeLessThan(free.road!.m);
		expect(free.road!.m - last.m).toBeLessThan(10);
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

	it('rides back the way it came at the end: one ride, two laps (#3205)', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride(climb);
		ride(free, 400, 30);
		free.turn('back'); // not at the end yet: nothing to turn
		expect(free.road!.atEnd).toBe(false);
		let t = 1_030_000;
		while (!free.road!.atEnd) {
			expect(t, 'never reached the end').toBeLessThan(2_000_000);
			ride(free, 400, 1, t);
			t += 1000;
		}
		free.turn('back');
		ride(free, 200, 20, t);
		expect(free.road!.m).toBeLessThan(2000);
		await free.end();
		const samples = (
			uploads[0] as {
				samples: { m: number; lap?: number; reverse?: boolean }[];
			}
		).samples;
		const back = samples.findIndex((s) => s.lap === 1);
		expect(back).toBeGreaterThan(0);
		expect(samples.slice(0, back).every((s) => s.lap === undefined)).toBe(true);
		expect(samples[back]).toMatchObject({ lap: 1, reverse: true });
		const after = samples.slice(back + 1);
		expect(after.every((s) => s.lap === 1 && s.reverse === undefined)).toBe(
			true,
		);
		// Down the stored road, as the server's bound holds a reversed lap.
		for (let i = back + 1; i < samples.length; i++)
			expect(samples[i].m).toBeLessThanOrEqual(samples[i - 1].m);
	});

	type Sample = { m: number; lap?: number; reverse?: boolean };
	/**
	 * The server's bound on a road ride's samples (rides/save.go's
	 * lapFollows): the first is lap 0, a lap's first sample stands anywhere,
	 * and within a lap m moves only the lap's way, at most MaxRoadSpeedMps a
	 * second.
	 */
	function heldToTheServersBound(samples: Sample[]) {
		expect(samples[0].lap ?? 0).toBe(0);
		let reverse = !!samples[0].reverse;
		for (let i = 1; i < samples.length; i++) {
			const [prev, next] = [samples[i - 1], samples[i]];
			if ((next.lap ?? 0) === (prev.lap ?? 0) + 1) {
				reverse = !!next.reverse;
				continue;
			}
			expect(next.lap ?? 0, `sample ${i}'s lap`).toBe(prev.lap ?? 0);
			const along = reverse ? prev.m - next.m : next.m - prev.m;
			expect(along, `sample ${i} moves the lap's way`).toBeGreaterThanOrEqual(
				0,
			);
			expect(along, `sample ${i} moves a rider's metres`).toBeLessThanOrEqual(
				MaxRoadSpeedMps,
			);
		}
	}
	const samplesOf = (upload: unknown) =>
		(upload as { samples: Sample[] }).samples;

	it('rides it again from the start: the new lap starts where it rides from (#3117)', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride(climb, 1900);
		let t = 1_000_000;
		while (!free.road!.atEnd) {
			expect(t, 'never reached the end').toBeLessThan(2_000_000);
			ride(free, 400, 1, t);
			t += 1000;
		}
		free.turn('again');
		expect(free.road!.m).toBe(0);
		ride(free, 250, 61, t);
		await free.end();
		const samples = samplesOf(uploads[0]);
		const again = samples.findIndex((s) => s.lap === 1);
		expect(samples[again].m).toBe(0);
		heldToTheServersBound(samples);
	});

	it('rolls on round a loop with no end-of-road card: one ride, two laps (#4261)', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride({ ...climb, loop: true }, 1900);
		let t = 1_000_000;
		while (free.road!.lap === 0 || free.road!.m > 100) {
			expect(t, 'never lapped').toBeLessThan(1_100_000);
			ride(free, 400, 1, t);
			t += 1000;
			expect(free.road!.atEnd).toBe(false);
			expect(roadEndOffered(free, false)).toBe(false);
		}
		expect(free.road!.virtualMps).toBeGreaterThan(5);
		ride(free, 250, 61, t);
		await free.end();
		const samples = samplesOf(uploads[0]);
		const next = samples.findIndex((s) => s.lap === 1);
		expect(samples[next].m).toBe(0);
		expect(samples[next].reverse).toBeUndefined();
		heldToTheServersBound(samples);
	});

	it('numbers a lap that crosses a loop’s line in its first second once (#4261)', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride({ ...climb, loop: true });
		ride(free, 300, 120);
		// A mate a metre or two short of the line: their lap is over at once.
		free.rideWith(1997, false);
		ride(free, 300, 30, 1_120_000);
		await free.end();
		heldToTheServersBound(samplesOf(uploads[0]));
	});

	it('rides with a mate before the ride starts: the road starts at their metre, their way (#3117)', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride(climb);
		free.rideWith(1500, true);
		expect(free.road).toMatchObject({
			m: 1500,
			reverse: true,
			lap: 0,
			from: 1500,
		});
		ride(free, 250, 61);
		await free.end();
		const samples = samplesOf(uploads[0]);
		expect(samples[0]).toMatchObject({ m: 1500, reverse: true });
		expect(samples.every((s) => s.lap === undefined)).toBe(true);
		heldToTheServersBound(samples);
	});

	it('rides with a mate mid-ride: a new lap from their metre, at your speed (#3117)', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride(climb);
		ride(free, 250, 40);
		const speed = free.road!.virtualMps;
		expect(speed).toBeGreaterThan(3);
		// A jump taken back before a second was ridden on it is no lap.
		free.rideWith(600, true);
		free.rideWith(1200, false);
		// You are there at once, still rolling.
		expect(free.road).toMatchObject({
			m: 1200,
			lap: 1,
			reverse: false,
			from: 1200,
		});
		expect(free.road!.virtualMps).toBeCloseTo(speed, 9);
		ride(free, 250, 30, 1_040_000);
		expect(free.road!.m - 1200).toBeGreaterThan(30 * speed * 0.8);
		await free.end();
		const samples = samplesOf(uploads[0]);
		expect(samples).toHaveLength(70);
		expect(samples[40]).toMatchObject({ m: 1200, lap: 1 });
		heldToTheServersBound(samples);
	});

	it('rides a borrowed road without saving against it (#3621)', async () => {
		const free = createFreeRide({ ftp: () => 250, kg: () => 75 });
		free.arm();
		free.ride({ ...climb, borrowed: true }, 500);
		ride(free, 250, 61);
		await free.end();
		const saved = uploads[0] as Record<string, unknown> & {
			samples: { m?: number }[];
		};
		// The server keeps a ride only on the rider's own route.
		expect(saved.routeId).toBeUndefined();
		expect(saved.drive).toBeUndefined();
		expect(saved.samples[0].m).toBeGreaterThanOrEqual(500);
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

describe('the road a free ride hands the session picker (#4224)', () => {
	it('is your own road, never a borrowed one', () => {
		expect(ownRoad({ id: 'r1', borrowed: false })).toBe('r1');
		expect(ownRoad({ id: 'r1', borrowed: true })).toBeUndefined();
		expect(ownRoad(null)).toBeUndefined();
	});
});
