// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
	bufferedRide,
	discardRide,
	refuseRide,
	discardRidesOf,
	KEEP_UNSAVED_MS,
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

/** Two riders sharing one browser (#2805). */
const ANA = 'rider-ana';
const BEN = 'rider-ben';
/** A localStorage that is full: every write refused. Undone by afterEach. */
function refuseStorage() {
	vi.stubGlobal('localStorage', {
		length: 0,
		key: () => null,
		getItem: () => null,
		removeItem: () => {},
		setItem: () => {
			throw new DOMException('full', 'QuotaExceededError');
		},
	});
}

/** A minute ago: a ride's id is its order after this (KEEP_UNSAVED_MS reads the age). */
const T0 = Date.now() - 60_000;
/** What Ana is offered back — the rider most of these tests are about. */
const offered = () => unfinishedRides(ANA);

/**
 * A ride with `count` samples, Ana's unless it says whose. Unless it is still
 * `recording`, the tab that rode it is gone — a crash, a closed tab — and so
 * is its lock (#2617).
 */
async function fill(
	rideId: string,
	count: number,
	opts: {
		end?: boolean;
		saveable?: boolean;
		recording?: boolean;
		owner?: string | null;
	} = {},
) {
	const buffer = await openRideBuffer({
		rideId,
		// null: a ride buffered before rides were stamped.
		ownerId: opts.owner === null ? undefined : (opts.owner ?? ANA),
		startedAt: T0 + (Number(rideId) || 1),
		workoutName: 'Openers',
		...(opts.saveable ? { workoutJson: '{"name":"Openers","steps":[]}' } : {}),
	});
	for (let seq = 1; seq <= count; seq++) buffer.append(sample(seq));
	if (opts.end) buffer.end();
	else if (!opts.recording) held.delete(`wattroom-ride-${rideId}`);
	return buffer;
}

// Web Locks by hand: which tab holds what is the test's to say, and Node's own
// would keep every lock a test never released for the rest of the file.
const held = new Set<string>();

beforeEach(() => {
	// A fresh database per test; fake-indexeddb is process-global.
	indexedDB = new IDBFactory();
	localStorage.clear();
	held.clear();
	vi.stubGlobal('navigator', {
		locks: {
			request: (name: string, hold: () => Promise<void>) => {
				held.add(name);
				return hold().finally(() => held.delete(name));
			},
			query: async () => ({ held: [...held].map((name) => ({ name })) }),
		},
	});
});
afterEach(() => vi.unstubAllGlobals());

describe('ride buffer', () => {
	it('offers back a ride that never ended — the crash case', async () => {
		await fill('100', 90);
		const rides = await offered();
		expect(rides).toHaveLength(1);
		expect(rides[0].samples).toHaveLength(90);
		expect(rides[0].samples[0].watts).toBe(201);
	});

	it('offers a ride whose workout changed back under every workout it rode (#4257)', async () => {
		const buffer = await fill('100', 90, { saveable: true, recording: true });
		buffer.retitle({
			workoutName: 'Openers + Free ride',
			workoutJson: '{"name":"Openers + Free ride","steps":[]}',
		});
		buffer.release();
		const [ride] = await offered();
		expect(ride.workoutName).toBe('Openers + Free ride');
		expect(ride.workoutJson).toContain('Openers + Free ride');
	});

	it('does not offer back a ride that finished properly', async () => {
		await fill('100', 90, { end: true });
		expect(await offered()).toHaveLength(0);
	});

	it('ignores a fragment under a minute — a misclick, not a lost ride', async () => {
		await fill('100', 30);
		expect(await offered()).toHaveLength(0);
	});

	it('replays only what a reconnect missed', async () => {
		const buffer = await fill('100', 10);
		const replay = await buffer.since(7);
		expect(replay.map((s) => s.seq)).toEqual([8, 9, 10]);
	});

	it('discard removes the ride and its samples', async () => {
		await fill('100', 90);
		await discardRide('100');
		expect(await offered()).toHaveLength(0);
	});

	it('keeps only the most recent finished rides', async () => {
		for (let i = 1; i <= 7; i++) await fill(String(i), 61, { end: true });
		// Opening one more triggers the prune: the five newest stay, the one
		// just opened among them, and the three oldest go.
		await fill('8', 61);
		expect(await stored()).toEqual(['4', '5', '6', '7', '8']);
	});

	it('keeps every unsaved ride however many came after, for a month (#4600)', async () => {
		for (let i = 1; i <= 7; i++) await fill(String(i), 61);
		await fill('8', 61);
		const ids = (await offered()).map((r) => r.rideId).sort();
		expect(ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
	});

	it('lets an unsaved ride go once it is older than a month (#4600)', () => {
		const now = 100 * KEEP_UNSAVED_MS;
		const ride = (id: string, age: number, endedAt?: number) => ({
			rideId: id,
			startedAt: now - age,
			workoutName: 'Openers',
			samples: 61,
			endedAt,
		});
		expect(
			stale(
				[
					ride('month-old', KEEP_UNSAVED_MS + 1),
					ride('29-days', KEEP_UNSAVED_MS - 86_400_000),
					// A saved one is under the count, not the month.
					ride('old-saved', KEEP_UNSAVED_MS + 1, now),
				],
				now,
			),
		).toEqual(['month-old']);
	});

	it('drops a fragment past the newest five, unfinished or not', () => {
		// A spectator joining a session opens a buffer nothing is ever written to.
		const join = (id: number) => ({
			rideId: String(id),
			startedAt: T0 + id,
			workoutName: 'session x',
			samples: 0,
		});
		expect(stale([1, 2, 3, 4, 5, 6].map(join))).toEqual(['1']);
	});

	it('does not let session joins walk an unsaved solo ride off the end (#794)', async () => {
		// The failed save is the oldest ride; every session joined since opened
		// a buffer of its own and ended it cleanly.
		await fill('1', 61, { saveable: true });
		for (let i = 2; i <= 8; i++) await fill(String(i), 61, { end: true });
		const rides = await offered();
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
		const [ride] = await offered();
		expect(ride.samples).toHaveLength(90);
		expect(ride.workoutJson).toBe('{"name":"Openers","steps":[]}');
	});

	it('stops being offered back once the save goes through', async () => {
		const buffer = await fill('100', 90, { saveable: true });
		buffer.end();
		expect(await offered()).toHaveLength(0);
	});

	it('offers a ride buffered before the retry existed, without the retry', async () => {
		// The store has no schema: an older ride simply has no workout on it,
		// and the card hides Save rather than offering a button that cannot work.
		await fill('100', 90);
		const [ride] = await offered();
		expect(ride.workoutJson).toBeUndefined();
	});
});

// #1466 finding 4. A store that will not open returns a buffer whose every
// method is a no-op, and the ride runs on with no crash safety at all.
// That is the right shape — a storage fault must never stop a ride — but
// it is known before the first pedal stroke, so the buffer has to SAY it.
describe('a store that will not open', () => {
	const openable = () =>
		openRideBuffer({
			rideId: '900',
			ownerId: ANA,
			startedAt: T0 + 900,
			workoutName: 'Openers',
		});

	it('is crash safe when the store opens', async () => {
		expect((await openable()).crashSafe).toBe(true);
	});

	it('keeps the ride in localStorage when there is no indexedDB (#4600)', async () => {
		const had = indexedDB;
		// @ts-expect-error — a browser whose IndexedDB is gone.
		indexedDB = undefined;
		try {
			const buffer = await openable();
			expect(buffer.crashSafe).toBe(true);
			for (let seq = 1; seq <= 90; seq++) buffer.append(sample(seq));
			// A reconnect still gets what the socket missed.
			expect((await buffer.since(88)).map((s) => s.seq)).toEqual([89, 90]);
			buffer.release();
			const [ride] = await offered();
			expect(ride.samples).toHaveLength(90);
			buffer.end();
			expect(await offered()).toEqual([]);
		} finally {
			indexedDB = had;
		}
	});

	it('says so when neither store will keep it', async () => {
		const had = indexedDB;
		// @ts-expect-error — site data switched off: no store at all.
		indexedDB = undefined;
		refuseStorage();
		try {
			const buffer = await openable();
			expect(buffer.crashSafe).toBe(false);
			// Still a working-looking object: the ride goes on.
			buffer.append(sample(1));
			buffer.end();
		} finally {
			indexedDB = had;
		}
	});

	it('gives up on an open that never answers (#4600)', async () => {
		vi.useFakeTimers();
		const real = indexedDB.open.bind(indexedDB);
		// A stuck backing store: the request never fires either way.
		indexedDB.open = () => ({}) as IDBOpenDBRequest;
		try {
			const opening = openable();
			await vi.advanceTimersByTimeAsync(5000);
			const buffer = await opening;
			vi.useRealTimers();
			indexedDB.open = real;
			// Not stuck, and kept all the same: in localStorage.
			for (let seq = 1; seq <= 90; seq++) buffer.append(sample(seq));
			expect(buffer.crashSafe).toBe(true);
			buffer.release();
			expect((await offered())[0].samples).toHaveLength(90);
		} finally {
			indexedDB.open = real;
			vi.useRealTimers();
		}
	});

	it('keeps the ride in localStorage when the open fails', async () => {
		const real = indexedDB.open.bind(indexedDB);
		indexedDB.open = () => {
			const request = real('wattroom-rides', 1);
			queueMicrotask(() => request.onerror?.(new Event('error')));
			return request;
		};
		try {
			const buffer = await openable();
			expect(buffer.crashSafe).toBe(true);
			for (let seq = 1; seq <= 90; seq++) buffer.append(sample(seq));
			buffer.release();
		} finally {
			indexedDB.open = real;
		}
		expect((await offered())[0].samples).toHaveLength(90);
	});

	// Firefox's private window throws here rather than firing onerror.
	// Unguarded that rejected the promise: the channel's `.then` had no
	// catch and the solo page refused to start the ride at all.
	it('keeps the ride when the open throws, rather than failing the ride', async () => {
		const real = indexedDB.open.bind(indexedDB);
		indexedDB.open = () => {
			throw new DOMException('denied', 'InvalidStateError');
		};
		try {
			await expect(openable()).resolves.toMatchObject({ crashSafe: true });
		} finally {
			indexedDB.open = real;
		}
	});
});

// #4600: a 3 h ride ended with nothing on the device. A store can stop
// mid-ride, and what a failed save leaves must be the whole ride.
describe('a store that stops keeping the ride', () => {
	const ride = () =>
		openRideBuffer({
			rideId: '700',
			ownerId: ANA,
			startedAt: T0 + 700,
			workoutName: 'Free ride',
			workoutJson: '{"name":"Free ride","unscored":true,"steps":[]}',
		});

	it('says so, and keeps the ride in localStorage from then', async () => {
		const buffer = await ride();
		for (let seq = 1; seq <= 40; seq++) buffer.append(sample(seq));
		await vi.waitFor(async () =>
			expect(await buffer.since(0)).toHaveLength(40),
		);
		// The disk fills: every put from now is refused.
		const put = vi
			.spyOn(IDBObjectStore.prototype, 'put')
			.mockImplementation(() => {
				throw new DOMException('full', 'QuotaExceededError');
			});
		try {
			for (let seq = 41; seq <= 90; seq++) buffer.append(sample(seq));
			await vi.waitFor(() =>
				expect(
					localStorage.getItem('wattroom.ride-rescue.v1.700'),
				).not.toBeNull(),
			);
			expect(buffer.crashSafe).toBe(true);
			buffer.release();
		} finally {
			put.mockRestore();
		}
		const [offer] = await offered();
		expect(offer.samples).toHaveLength(90);
		expect(offer.workoutJson).toContain('Free ride');
	});

	it('keeps every second a failed save hands it, whatever the appends wrote', async () => {
		const buffer = await ride();
		for (let seq = 1; seq <= 10; seq++) buffer.append(sample(seq));
		const all = Array.from({ length: 90 }, (_, i) => sample(i + 1));
		expect(await buffer.keep(all)).toBe(true);
		buffer.release();
		expect((await offered())[0].samples).toHaveLength(90);
	});

	it('keeps it in localStorage when IndexedDB refuses the whole ride', async () => {
		const buffer = await ride();
		const put = vi
			.spyOn(IDBObjectStore.prototype, 'put')
			.mockImplementation(() => {
				throw new DOMException('full', 'QuotaExceededError');
			});
		try {
			const all = Array.from({ length: 90 }, (_, i) => sample(i + 1));
			expect(await buffer.keep(all)).toBe(true);
		} finally {
			put.mockRestore();
		}
		buffer.release();
		expect((await offered())[0].samples).toHaveLength(90);
		await discardRide('700');
		expect(await offered()).toEqual([]);
	});

	it('remembers a refusal for good, in either store (#4600)', async () => {
		const buffer = await ride();
		for (let seq = 1; seq <= 90; seq++) buffer.append(sample(seq));
		buffer.release();
		await vi.waitFor(async () =>
			expect((await offered())[0]?.samples).toHaveLength(90),
		);
		await refuseRide('700', 'Overlaps a ride.');
		expect((await offered())[0].refused).toBe('Overlaps a ride.');
	});

	it('answers false when nothing will take it', async () => {
		const buffer = await ride();
		const put = vi
			.spyOn(IDBObjectStore.prototype, 'put')
			.mockImplementation(() => {
				throw new DOMException('full', 'QuotaExceededError');
			});
		refuseStorage();
		try {
			expect(await buffer.keep([sample(1)])).toBe(false);
			expect(buffer.crashSafe).toBe(false);
		} finally {
			put.mockRestore();
		}
	});
});

// A ride still being recorded is not a crash (#2617). Another tab riding, or
// this tab in a live session, holds the ride's lock; offering it back filed a
// partial ride under Save and let Discard delete a live session's only local
// copy. A tab that crashes or closes lets go of the lock by itself.
describe('a ride still being recorded', () => {
	it('is not offered back while it is being recorded', async () => {
		await fill('1', 60, { recording: true });
		expect(await offered()).toEqual([]);
	});

	it('is offered back once the tab recording it is gone', async () => {
		await fill('1', 60, { recording: true });
		held.clear();
		expect(await offered()).toHaveLength(1);
	});

	it('is offered back once recording stops without a save', async () => {
		const buffer = await fill('1', 60, { recording: true });
		buffer.release();
		await vi.waitFor(async () => expect(await offered()).toHaveLength(1));
	});
});

/** Every ride the store holds, finished or not — what a purge must reach. */
async function stored(): Promise<string[]> {
	const db = await new Promise<IDBDatabase>((resolve) => {
		const request = indexedDB.open('wattroom-rides', 1);
		request.onsuccess = () => resolve(request.result);
	});
	const ids = await new Promise<IDBValidKey[]>((resolve) => {
		const request = db
			.transaction('rides', 'readonly')
			.objectStore('rides')
			.getAllKeys();
		request.onsuccess = () => resolve(request.result);
	});
	db.close();
	return ids.map(String).sort();
}

// One laptop beside one trainer, and whoever signs in on it (#2805). A ride
// carries its rider's heart rate, and the recovery card offered Ana's crash
// to Ben with a Save that filed it into his history.
describe('a browser two riders share', () => {
	it("never offers one rider's ride to another", async () => {
		await fill('100', 90, { saveable: true });
		expect(await unfinishedRides(BEN)).toEqual([]);
	});

	it("keeps a signed-out rider's ride for when they are back", async () => {
		await fill('100', 90, { saveable: true });
		await unfinishedRides(BEN);
		const [ride] = await offered();
		expect(ride.ownerId).toBe(ANA);
		expect(ride.samples).toHaveLength(90);
	});

	it('offers a ride from before rides were stamped, naming nobody', async () => {
		// Its rider cannot be told apart, so the card offers it without Save.
		await fill('100', 90, { saveable: true, owner: null });
		const [ride] = await unfinishedRides(BEN);
		expect(ride.ownerId).toBeUndefined();
	});

	it("takes an account's rides with it, finished or not, and nobody else's", async () => {
		await fill('1', 90);
		await fill('2', 90, { end: true });
		await fill('3', 90, { owner: BEN });
		await fill('4', 90, { owner: null });
		await discardRidesOf(ANA);
		expect(await stored()).toEqual(['3', '4']);
	});
});

// A refused save ends its ride, and the summary it leaves on Rides opens it
// (#4262): the seconds are there until the prune takes them.
describe('a ride whose save was refused', () => {
	it('keeps its seconds for its summary, ended as it is', async () => {
		await fill('100', 90, { saveable: true, end: true });
		const ride = await bufferedRide('100', ANA);
		expect(ride?.samples).toHaveLength(90);
		expect(ride?.workoutJson).toBeDefined();
	});

	it("is never another rider's", async () => {
		await fill('100', 90, { saveable: true, end: true });
		expect(await bufferedRide('100', BEN)).toBeNull();
	});

	it('is nothing once the prune took it, or under a minute', async () => {
		expect(await bufferedRide('100', ANA)).toBeNull();
		await fill('200', 30, { end: true });
		expect(await bufferedRide('200', ANA)).toBeNull();
	});
});
