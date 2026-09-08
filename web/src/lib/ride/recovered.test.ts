import { describe, expect, it } from 'vitest';
import {
	exportFilename,
	exportPayload,
	uploadPayload,
	type RecoveredRide,
} from './recovered';

/** 2026-03-14T09:30:00Z, so the filename's day is unambiguous in either hemisphere. */
const STARTED = Date.UTC(2026, 2, 14, 9, 30);

const ride = (over: Partial<RecoveredRide> = {}): RecoveredRide => ({
	rideId: 'r1',
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
});

describe('exportFilename', () => {
	it('names the file for the day the ride happened', () => {
		expect(exportFilename(ride())).toBe('wattroom-recovered-2026-03-14.fit');
	});
});
