import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
	discardRide,
	openRideBuffer,
	stale,
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
		...(opts.saveable ? { workoutJson: '{"name":"Openers","steps":[]}' } : {}),
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
		// Opening one more triggers the prune: the five newest stay, the one
		// just opened is a fragment at that moment and rides along, and the
		// two oldest go.
		await fill('8', 61);
		const ids = (await unfinishedRides()).map((r) => r.rideId).sort();
		expect(ids).toEqual(['3', '4', '5', '6', '7', '8']);
	});

	it('drops a fragment past the newest five, unfinished or not', () => {
		// A spectator's room join opens a buffer nothing is ever written to.
		const join = (id: number) => ({
			rideId: String(id),
			startedAt: id,
			workoutName: 'room x',
			samples: 0,
		});
		expect(stale([1, 2, 3, 4, 5, 6].map(join))).toEqual(['1']);
	});

	it('does not let room joins walk an unsaved solo ride off the end (#794)', async () => {
		// The failed save is the oldest ride; every room joined since opened
		// a buffer of its own and ended it cleanly.
		await fill('1', 61, { saveable: true });
		for (let i = 2; i <= 8; i++) await fill(String(i), 61, { end: true });
		const rides = await unfinishedRides();
		expect(rides.map((r) => r.rideId)).toContain('1');
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

// #1466 finding 4. A store that will not open returns a buffer whose every
// method is a no-op, and the ride runs on with no crash safety at all.
// That is the right shape — a storage fault must never stop a ride — but
// it is known before the first pedal stroke, so the buffer has to SAY it.
describe('a store that will not open', () => {
	const openable = () =>
		openRideBuffer({ rideId: '900', startedAt: 900, workoutName: 'Openers' });

	it('is crash safe when the store opens', async () => {
		expect((await openable()).crashSafe).toBe(true);
	});

	it('says so when there is no indexedDB at all', async () => {
		const had = indexedDB;
		// @ts-expect-error — a browser with site data switched off.
		indexedDB = undefined;
		try {
			const buffer = await openable();
			expect(buffer.crashSafe).toBe(false);
			// Still a working-looking object: the ride goes on.
			buffer.append(sample(1));
			buffer.end();
			expect(await buffer.since(0)).toEqual([]);
		} finally {
			indexedDB = had;
		}
	});

	it('says so when the open fails', async () => {
		const real = indexedDB.open.bind(indexedDB);
		indexedDB.open = () => {
			const request = real('wattroom-rides', 1);
			queueMicrotask(() => request.onerror?.(new Event('error')));
			return request;
		};
		try {
			expect((await openable()).crashSafe).toBe(false);
		} finally {
			indexedDB.open = real;
		}
	});

	// Firefox's private window throws here rather than firing onerror.
	// Unguarded that rejected the promise: the room's `.then` had no
	// catch and the solo page refused to start the ride at all.
	it('says so when the open throws, rather than failing the ride', async () => {
		const real = indexedDB.open.bind(indexedDB);
		indexedDB.open = () => {
			throw new DOMException('denied', 'InvalidStateError');
		};
		try {
			await expect(openable()).resolves.toMatchObject({ crashSafe: false });
		} finally {
			indexedDB.open = real;
		}
	});
});
