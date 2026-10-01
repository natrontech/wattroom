import { describe, expect, it } from 'vitest';
import {
	canSave,
	exportFilename,
	exportPayload,
	uploadPayload,
	type RecoveredRide,
	resumeAt,
} from './recovered';

/** 2026-03-14T09:30:00Z, so the filename's day is unambiguous in either hemisphere. */
const STARTED = Date.UTC(2026, 2, 14, 9, 30);

const ride = (over: Partial<RecoveredRide> = {}): RecoveredRide => ({
	rideId: 'r1',
	ownerId: 'rider-ana',
	startedAt: STARTED,
	workoutName: 'Openers',
	workoutJson: '{"name":"Openers","steps":[]}',
	samples: [
		{ seq: 1, watts: 200, cadence: 90, heartRate: 140, at: STARTED },
		{ seq: 2, watts: 210, cadence: 92, heartRate: 142, at: STARTED + 1000 },
	],
	...over,
});

describe('exportPayload', () => {
	it('numbers the samples by position, which is what the .fit encoder reads', () => {
		expect(exportPayload(ride()).samples).toEqual([
			{ second: 0, watts: 200, cadence: 90, heartRate: 140 },
			{ second: 1, watts: 210, cadence: 92, heartRate: 142 },
		]);
	});

	it('sends the start as an ISO string, not an epoch', () => {
		expect(exportPayload(ride()).startedAt).toBe('2026-03-14T09:30:00.000Z');
	});
});

describe('uploadPayload', () => {
	it('spells heart rate the way the ride endpoint does, and drops the index', () => {
		expect(uploadPayload(ride())?.samples).toEqual([
			{ watts: 200, cadence: 90, hr: 140 },
			{ watts: 210, cadence: 92, hr: 142 },
		]);
	});

	it('carries the workout through, since that is what makes it a ride', () => {
		const payload = uploadPayload(ride());
		expect(payload?.workoutName).toBe('Openers');
		expect(payload?.workoutJson).toBe('{"name":"Openers","steps":[]}');
	});

	it('refuses a ride buffered before the workout was kept (#794)', () => {
		expect(uploadPayload(ride({ workoutJson: undefined }))).toBeNull();
	});

	// Whoever is signed in is not who rode it (#2805): a ride from before rides
	// were stamped would file its rider's heart rate into the next account.
	it('refuses a ride that names no rider', () => {
		expect(uploadPayload(ride({ ownerId: undefined }))).toBeNull();
	});
});

describe('canSave', () => {
	it("offers Save for a rider's own ride with its workout", () => {
		expect(canSave(ride())).toBe(true);
	});

	it('never for a ride that names no rider — Download and Discard only', () => {
		expect(canSave(ride({ ownerId: undefined }))).toBe(false);
	});
});

describe('exportFilename', () => {
	it('names the file for the day the ride happened', () => {
		expect(exportFilename(ride())).toBe('wattroom-recovered-2026-03-14.fit');
	});
});

// #3027: a free ride on a road, buffered, saves against its route and
// offers to carry on from where it stopped.
describe('a recovered ride on a road', () => {
	const onRoad = ride({
		ownerId: 'rider-1',
		workoutJson: '{"name":"Free ride","unscored":true,"steps":[]}',
		routeId: 'route-1',
		samples: [
			{
				seq: 1,
				watts: 200,
				cadence: 85,
				heartRate: 120,
				m: 0,
				alt: 100,
				at: STARTED,
			},
			{
				seq: 2,
				watts: 200,
				cadence: 85,
				heartRate: 121,
				m: 6.4,
				alt: 100.3,
				at: STARTED + 1000,
			},
		],
	});

	it('saves against its route, with its metres and heights', () => {
		const payload = uploadPayload(onRoad)!;
		expect(payload.routeId).toBe('route-1');
		expect(payload.samples[1]).toMatchObject({ m: 6.4, alt: 100.3 });
	});

	it('offers to carry on from its last metre', () => {
		expect(resumeAt(onRoad)).toEqual({ routeId: 'route-1', m: 6.4 });
	});

	it('leaves every other ride as it was', () => {
		const plain = ride({ ownerId: 'rider-1', workoutJson: '{}' });
		expect(resumeAt(plain)).toBeNull();
		const payload = uploadPayload(plain)!;
		expect(payload).not.toHaveProperty('routeId');
		for (const sample of payload.samples)
			expect(sample).not.toHaveProperty('m');
	});
});
