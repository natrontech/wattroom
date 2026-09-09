/**
 * The IndexedDB ride buffer (#19) — WATTROOM.md's crash-safety seam.
 *
 * Every recorded sample lands here as well as wherever else it goes (the solo
 * recording, the room WS). A browser crash at minute 55 then loses nothing:
 * the ride is on disk, recoverable as a .fit, and a room reconnect can replay
 * what the socket dropped.
 *
 * Appends are fire-and-forget: a storage problem must never disturb a ride,
 * so every operation swallows failure and the buffer silently degrades to
 * "no crash safety" rather than to "no ride".
 */
export interface BufferedSample {
	/** Strictly increasing per ride; doubles as the WS seq for server dedupe. */
	seq: number;
	watts: number;
	cadence: number;
	heartRate: number;
	/** The trim this second was ridden at (#1530) — 1 for a ride with no trim. */
	bias?: number;
	/** ms epoch */
	at: number;
}

export interface RideMeta {
	rideId: string;
	startedAt: number;
	workoutName: string;
	/**
	 * Enough to save the ride to the account later (#794). A ride whose upload
	 * failed stays here unfinished and is offered back, and an offer you
	 * cannot act on is not an offer — so the buffer carries what the POST
	 * needs, not just what a .fit needs (the server scores against the
	 * account's FTP, so no FTP rides along). Absent on rides buffered before
	 * this existed; the retry hides itself for those.
	 */
	workoutJson?: string;
	/** Set when the ride is SAVED, not when the recording stops (#794). */
	endedAt?: number;
}

const DB_NAME = 'wattroom-rides';
const KEEP_RIDES = 5;
/** Under a minute of samples is a misclick, not a lost ride. */
export const MIN_SAMPLES = 60;

/** Every sample of one ride — the store's key is [rideId, seq]. */
function samplesOf(rideId: string): IDBKeyRange {
	return IDBKeyRange.bound([rideId, -Infinity], [rideId, Infinity]);
}

function open(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		if (typeof indexedDB === 'undefined') return resolve(null);
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			db.createObjectStore('samples', { keyPath: ['rideId', 'seq'] });
			db.createObjectStore('rides', { keyPath: 'rideId' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
	});
}

/** One transaction, promisified; resolves null on any failure. */
function tx<T>(
	db: IDBDatabase,
	mode: IDBTransactionMode,
	run: (samples: IDBObjectStore, rides: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
	return new Promise((resolve) => {
		try {
			const t = db.transaction(['samples', 'rides'], mode);
			const request = run(t.objectStore('samples'), t.objectStore('rides'));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

export interface RideBuffer {
	append(sample: BufferedSample): void;
	/**
	 * Marks the ride finished — it stops being a crash to recover from. Call
	 * it when the ride is SAFE, which means the server has it: recording
	 * completion and upload acknowledgement are two different events, and
	 * ending on the first one is what used to drop a failed save (#794).
	 */
	end(): void;
	/** Samples since (exclusive) a seq, for reconnect replay. */
	since(seq: number): Promise<BufferedSample[]>;
}

export async function openRideBuffer(meta: RideMeta): Promise<RideBuffer> {
	const db = await open();
	if (db) {
		await tx(db, 'readwrite', (_, rides) => rides.put(meta));
		await prune(db);
	}
	return {
		append(sample) {
			if (!db) return;
			void tx(db, 'readwrite', (samples) =>
				samples.put({ ...sample, rideId: meta.rideId }),
			);
		},
		end() {
			if (!db) return;
			void tx(db, 'readwrite', (_, rides) =>
				rides.put({ ...meta, endedAt: Date.now() }),
			);
		},
		async since(seq) {
			if (!db) return [];
			const all = await readSamples(db, meta.rideId);
			return all.filter((s) => s.seq > seq);
		},
	};
}

function readSamples(
	db: IDBDatabase,
	rideId: string,
): Promise<BufferedSample[]> {
	return tx(db, 'readonly', (samples) =>
		samples.getAll(samplesOf(rideId)),
	).then((rows) => (rows ?? []) as BufferedSample[]);
}

/** Rides that never ended and have samples: the crashes worth offering back. */
export async function unfinishedRides(): Promise<
	Array<RideMeta & { samples: BufferedSample[] }>
> {
	const db = await open();
	if (!db) return [];
	const rides = ((await tx(db, 'readonly', (_, r) => r.getAll())) ??
		[]) as RideMeta[];
	const out: Array<RideMeta & { samples: BufferedSample[] }> = [];
	for (const ride of rides) {
		if (ride.endedAt) continue;
		const samples = await readSamples(db, ride.rideId);
		if (samples.length >= MIN_SAMPLES) out.push({ ...ride, samples });
	}
	return out;
}

export async function discardRide(rideId: string): Promise<void> {
	const db = await open();
	if (db) await discard(db, rideId);
}

function discard(db: IDBDatabase, rideId: string): Promise<unknown> {
	return tx(db, 'readwrite', (samples, rides) => {
		samples.delete(samplesOf(rideId));
		return rides.delete(rideId);
	});
}

/**
 * Which rides a prune discards — the cap is the quota story. The newest
 * KEEP_RIDES stay. Past them a finished ride or a fragment goes, and a ride
 * the server never confirmed stays until there are KEEP_RIDES of those too:
 * every room join opens a buffer, and five of them used to walk a failed
 * solo save off the end (#794, audit 2026-09-09).
 */
export function stale(rides: Array<RideMeta & { samples: number }>): string[] {
	let unsaved = 0;
	const out: string[] = [];
	[...rides]
		.sort((a, b) => b.startedAt - a.startedAt)
		.forEach((ride, i) => {
			const recoverable = !ride.endedAt && ride.samples >= MIN_SAMPLES;
			if (recoverable) unsaved++;
			if (i >= KEEP_RIDES && (!recoverable || unsaved > KEEP_RIDES))
				out.push(ride.rideId);
		});
	return out;
}

async function prune(db: IDBDatabase): Promise<void> {
	const rides = ((await tx(db, 'readonly', (_, r) => r.getAll())) ??
		[]) as RideMeta[];
	const counted: Array<RideMeta & { samples: number }> = [];
	for (const ride of rides) {
		const samples =
			(await tx(db, 'readonly', (s) => s.count(samplesOf(ride.rideId)))) ?? 0;
		counted.push({ ...ride, samples });
	}
	for (const rideId of stale(counted)) await discard(db, rideId);
}
