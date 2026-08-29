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
	/** ms epoch */
	at: number;
}

export interface RideMeta {
	rideId: string;
	startedAt: number;
	workoutName: string;
	endedAt?: number;
}

const DB_NAME = 'wattroom-rides';
const KEEP_RIDES = 5;

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
	/** Marks the ride finished — it stops being a crash to recover from. */
	end(): void;
	/** Samples since (exclusive) a seq, for reconnect replay. */
	since(seq: number): Promise<BufferedSample[]>;
}

export async function openRideBuffer(meta: RideMeta): Promise<RideBuffer> {
	const db = await open();
	if (db) {
		await tx(db, 'readwrite', (_, rides) => rides.put(meta));
		void prune(db);
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
		samples.getAll(IDBKeyRange.bound([rideId, -Infinity], [rideId, Infinity])),
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
		// Under a minute of samples is a misclick, not a lost ride.
		if (samples.length >= 60) out.push({ ...ride, samples });
	}
	return out;
}

export async function discardRide(rideId: string): Promise<void> {
	const db = await open();
	if (!db) return;
	await tx(db, 'readwrite', (samples, rides) => {
		samples.delete(IDBKeyRange.bound([rideId, -Infinity], [rideId, Infinity]));
		return rides.delete(rideId);
	});
}

/** Oldest rides out beyond the keep-count — the cap is the quota story. */
async function prune(db: IDBDatabase): Promise<void> {
	const rides = ((await tx(db, 'readonly', (_, r) => r.getAll())) ??
		[]) as RideMeta[];
	const stale = rides
		.sort((a, b) => b.startedAt - a.startedAt)
		.slice(KEEP_RIDES);
	for (const ride of stale) await discardRide(ride.rideId);
}
