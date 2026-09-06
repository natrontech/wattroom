import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
	discardRide,
	openRideBuffer,
	unfinishedRides,
	type BufferedSample,
} from './buffer';

const sample = (seq: number): BufferedSample => ({
	seq,
	watts: 200 + seq,
	cadence: 88,
	heartRate: 0,
	at: seq * 1000,
});

async function fill(
	rideId: string,
	count: number,
	opts: { end?: boolean; saveable?: boolean } = {},
) {
	const buffer = await openRideBuffer({
		rideId,
		startedAt: Number(rideId) || 1,
		workoutName: 'Openers',
		...(opts.saveable
			? { workoutJson: '{"name":"Openers","steps":[]}', ftp: 240 }
			: {}),
	});
	for (let seq = 1; seq <= count; seq++) buffer.append(sample(seq));
	if (opts.end) buffer.end();
	return buffer;
}

beforeEach(() => {
	// A fresh database per test; fake-indexeddb is process-global.
	indexedDB = new IDBFactory();
});

describe('ride buffer', () => {
	it('offers back a ride that never ended — the crash case', async () => {
		await fill('100', 90);
		const rides = await unfinishedRides();
		expect(rides).toHaveLength(1);
		expect(rides[0].samples).toHaveLength(90);
		expect(rides[0].samples[0].watts).toBe(201);
	});

	it('does not offer back a ride that finished properly', async () => {
		await fill('100', 90, { end: true });
		expect(await unfinishedRides()).toHaveLength(0);
	});

	it('ignores a fragment under a minute — a misclick, not a lost ride', async () => {
		await fill('100', 30);
		expect(await unfinishedRides()).toHaveLength(0);
	});

	it('replays only what a reconnect missed', async () => {
		const buffer = await fill('100', 10);
		const replay = await buffer.since(7);
		expect(replay.map((s) => s.seq)).toEqual([8, 9, 10]);
	});

	it('discard removes the ride and its samples', async () => {
		await fill('100', 90);
		await discardRide('100');
		expect(await unfinishedRides()).toHaveLength(0);
	});

	it('keeps only the most recent rides', async () => {
		for (let i = 1; i <= 7; i++) await fill(String(i), 61);
		// Opening one more triggers the prune; the two oldest go.
		await fill('8', 61);
		const rides = await unfinishedRides();
		expect(rides.length).toBeLessThanOrEqual(5);
		expect(rides.some((r) => r.rideId === '1')).toBe(false);
	});
});

describe('a solo save that failed (#794)', () => {
	// The recording finishing and the server having the ride are two different
	// events. end() used to be called on the first, so a failed upload left
	// nothing to recover: the samples were still on disk, and nothing offered
	// them back.
	it('is still offered back, with what a retry needs', async () => {
		await fill('100', 90, { saveable: true });
		const [ride] = await unfinishedRides();
		expect(ride.samples).toHaveLength(90);
		expect(ride.workoutJson).toBe('{"name":"Openers","steps":[]}');
		expect(ride.ftp).toBe(240);
	});

	it('stops being offered back once the save goes through', async () => {
		const buffer = await fill('100', 90, { saveable: true });
		buffer.end();
		expect(await unfinishedRides()).toHaveLength(0);
	});

	it('offers a ride buffered before the retry existed, without the retry', async () => {
		// The store has no schema: an older ride simply has no workout on it,
		// and the card hides Save rather than offering a button that cannot work.
		await fill('100', 90);
		const [ride] = await unfinishedRides();
		expect(ride.workoutJson).toBeUndefined();
	});
});
