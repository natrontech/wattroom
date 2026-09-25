/**
 * The IndexedDB ride buffer (#19) — WATTROOM.md's crash-safety seam.
 *
 * Every recorded sample lands here as well as wherever else it goes (the solo
 * recording, the voice channel's socket). A browser crash at minute 55 then
 * loses nothing: the ride is on disk, recoverable as a .fit, and a reconnect
 * to the channel can replay what the socket dropped.
 *
 * Appends are fire-and-forget: a storage problem must never disturb a ride,
 * so every operation swallows failure and the buffer degrades to "no crash
 * safety" rather than to "no ride". Silently, except at the open: that one is
 * known before the first pedal stroke and is the rider's to hear, so it is
 * reported as `crashSafe` and shown as persistent status (#1466 finding 4,
 * ADR-0052 rule 3).
 */
export interface BufferedSample {
	/** Strictly increasing per ride; doubles as the WS seq for server dedupe. */
	seq: number;
	watts: number;
	cadence: number;
	heartRate: number;
	/** The trim this second was ridden at (#1530) — 1 for a ride with no trim. */
	bias?: number;
	/** The workout second it was ridden at (#1733) — absent on a ride buffered before it. */
	clock?: number;
	/** The guard had the trainer off the target this second (#1796). */
	released?: boolean;
	/** ms epoch */
	at: number;
}

export interface RideMeta {
	rideId: string;
	/**
	 * The account that recorded the ride (#2805). One browser serves everyone
	 * who signs in on it — the laptop beside a shared trainer — and a ride,
	 * heart rate and all, is its rider's alone: offered back only to them,
	 * kept for them across a sign-out, taken when their account is deleted.
	 * Absent on a ride buffered before it, whose rider nobody can name.
	 */
	ownerId?: string;
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
		// `indexedDB.open` THROWS in a Firefox private window rather than
		// firing onerror, and an unguarded throw here rejected the promise:
		// the channel's `.then` had no catch, and the solo page turned a missing
		// backup into a ride that would not start. A store that will not open
		// is `null` however it refuses.
		try {
			const request = indexedDB.open(DB_NAME, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				db.createObjectStore('samples', { keyPath: ['rideId', 'seq'] });
				db.createObjectStore('rides', { keyPath: 'rideId' });
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
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
	/**
	 * Whether the buffer is actually storing anything (#1466 finding 4).
	 * False means the store would not open — a private window, a browser
	 * with site data blocked, a full disk — and every method below is a
	 * no-op, so the ride runs with no crash safety at all. Known before the
	 * first pedal stroke, which is why it is told rather than swallowed:
	 * the degrading is right for a mid-ride append and wrong for the open.
	 */
	readonly crashSafe: boolean;
	append(sample: BufferedSample): void;
	/**
	 * Marks the ride finished — it stops being a crash to recover from. Call
	 * it when the ride is SAFE, which means the server has it: recording
	 * completion and upload acknowledgement are two different events, and
	 * ending on the first one is what used to drop a failed save (#794).
	 */
	end(): void;
	/**
	 * This tab stopped recording the ride without the server having it — a
	 * failed save, a session left mid-ride (#2617). Until then the ride is
	 * being recorded and is not offered back, in this tab or any other; from
	 * then it is a ride to recover. end() does this too.
	 */
	release(): void;
	/** Samples since (exclusive) a seq, for reconnect replay. */
	since(seq: number): Promise<BufferedSample[]>;
}

/** The Web Lock a tab holds on a ride while it records it (#2617). */
const RECORDING = 'wattroom-ride-';

/**
 * Holds a Web Lock until the returned function is called or the tab goes
 * away — a tab that crashes or closes lets go by itself, which is the point.
 * Without Web Locks nothing is held, and every ride reads as not being
 * recorded, which is how the buffer behaved before them.
 */
function hold(name: string): () => void {
	let release = () => {};
	try {
		const held = new Promise<void>((resolve) => (release = resolve));
		void navigator.locks.request(name, () => held).catch(() => {});
	} catch {
		// No navigator, or no locks on it.
	}
	return release;
}

/** The rides some tab is recording right now. */
async function recording(): Promise<Set<string>> {
	try {
		const { held = [] } = await navigator.locks.query();
		return new Set(held.map((lock) => lock.name ?? ''));
	} catch {
		return new Set();
	}
}

/**
 * `ownerId` is required here and optional on RideMeta: every ride from now on
 * says whose it is, and only a ride from before could not (#2805).
 */
export async function openRideBuffer(
	meta: RideMeta & { ownerId: string | undefined },
): Promise<RideBuffer> {
	const db = await open();
	if (db) {
		await tx(db, 'readwrite', (_, rides) => rides.put(meta));
		await prune(db);
	}
	const release = db ? hold(RECORDING + meta.rideId) : () => {};
	return {
		crashSafe: db !== null,
		append(sample) {
			if (!db) return;
			void tx(db, 'readwrite', (samples) =>
				samples.put({ ...sample, rideId: meta.rideId }),
			);
		},
		end() {
			if (!db) return;
			// Let go once the mark is written, or another tab could find the
			// ride neither held nor ended in between and offer it back.
			void tx(db, 'readwrite', (_, rides) =>
				rides.put({ ...meta, endedAt: Date.now() }),
			).then(release);
		},
		release,
		async since(seq) {
			if (!db) return [];
			// The rows past `seq` and no others (#2839): reading the whole
			// ride to filter it made every reconnect cost the ride's length.
			const rows = await tx(db, 'readonly', (samples) =>
				samples.getAll(
					IDBKeyRange.bound([meta.rideId, seq], [meta.rideId, Infinity], true),
				),
			);
			return (rows ?? []) as BufferedSample[];
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

/**
 * The rider's rides that never ended, have samples and nobody is recording:
 * the crashes worth offering back. Another account's never are (#2805) — a
 * ride from before rides were stamped comes along too, since it may well be
 * this rider's, and the card offers it without the Save that would file it.
 */
export async function unfinishedRides(
	ownerId: string,
): Promise<Array<RideMeta & { samples: BufferedSample[] }>> {
	const db = await open();
	if (!db) return [];
	const rides = await allRides(db);
	const held = await recording();
	const out: Array<RideMeta & { samples: BufferedSample[] }> = [];
	for (const ride of rides) {
		if (ride.ownerId && ride.ownerId !== ownerId) continue;
		// Still being recorded, here or in another tab: not a crash (#2617).
		if (ride.endedAt || held.has(RECORDING + ride.rideId)) continue;
		const samples = await readSamples(db, ride.rideId);
		if (samples.length >= MIN_SAMPLES) out.push({ ...ride, samples });
	}
	return out;
}

function allRides(db: IDBDatabase): Promise<RideMeta[]> {
	return tx(db, 'readonly', (_, rides) => rides.getAll()).then(
		(rows) => (rows ?? []) as RideMeta[],
	);
}

/**
 * Every ride an account left in this browser, finished or not (#2805): the
 * device half of deleting the account. Its rides carry its heart rate, and a
 * full purge that leaves five of them on the laptop is not one.
 */
export async function discardRidesOf(ownerId: string): Promise<void> {
	const db = await open();
	if (!db) return;
	for (const ride of await allRides(db))
		if (ride.ownerId === ownerId) await discard(db, ride.rideId);
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
 * every session joined opens a buffer, and five of them used to walk a failed
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
	const rides = await allRides(db);
	const counted: Array<RideMeta & { samples: number }> = [];
	for (const ride of rides) {
		const samples =
			(await tx(db, 'readonly', (s) => s.count(samplesOf(ride.rideId)))) ?? 0;
		counted.push({ ...ride, samples });
	}
	for (const rideId of stale(counted)) await discard(db, rideId);
}
