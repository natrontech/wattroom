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
 * safety" rather than to "no ride". Never silently (#4600): an open that
 * fails or hangs, and a write the store did not commit, turn `crashSafe`
 * false, which the riding screen shows as persistent status (#1466 finding 4,
 * ADR-0052 rule 3). From then on the buffer keeps the ride in localStorage as
 * well, a second store for the rare browser whose IndexedDB stopped working.
 */
import { MinRideSamples } from '#lib/protocol.ts';
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
	/** On a road, metres along it (#3027): where a resumed ride starts again. */
	m?: number;
	/** And the road's height there, as the save carries it. */
	alt?: number;
	/** Its lap, and on a lap's first sample which way it runs (#3205). */
	lap?: number;
	reverse?: boolean;
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
	/**
	 * The stored route a free ride on a road rode (#3027): a recovered one
	 * saves against it, and offers to carry on along it.
	 */
	routeId?: string;
	/**
	 * How the trainer rode that route (#3516), known once the ride ended: a
	 * ride saved later claims its time on the road as one saved at once would.
	 */
	drive?: 'sim' | 'gears' | 'ergByRoad';
	/**
	 * The server's words when it refused the ride for good (#4600): sending it
	 * again would be refused again, so nothing sends it on its own; the card
	 * still offers it to download.
	 */
	refused?: string;
	/** Set when the ride is SAVED, not when the recording stops (#794). */
	endedAt?: number;
}

const DB_NAME = 'wattroom-rides';
const KEEP_RIDES = 5;
/**
 * How long a ride the account never got stays on the device (#4600): long
 * enough for a rider back from a week away, short enough that a ride nobody
 * comes back for does not sit on the disk for good.
 */
export const KEEP_UNSAVED_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * How long an open may take before the store counts as not there (#4600). A
 * Chromium whose IndexedDB backing store is stuck answers neither success nor
 * error, and a buffer that waited for it recorded nothing for a whole ride.
 */
const OPEN_TIMEOUT_MS = 5000;
/** The second store's key for one ride (#4600). */
const RESCUE = 'wattroom.ride-rescue.v1.';
/** How often, in samples, a ride the first store lost is copied to the second. */
const RESCUE_EVERY = 30;

/** Every sample of one ride — the store's key is [rideId, seq]. */
function samplesOf(rideId: string): IDBKeyRange {
	return IDBKeyRange.bound([rideId, -Infinity], [rideId, Infinity]);
}

function open(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		if (typeof indexedDB === 'undefined') return resolve(null);
		let late = false;
		const timer = setTimeout(() => {
			late = true;
			resolve(null);
		}, OPEN_TIMEOUT_MS);
		const settle = (db: IDBDatabase | null) => {
			clearTimeout(timer);
			// Answered after we gave up: nothing uses it, so let it go.
			if (late) db?.close();
			else resolve(db);
		};
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
			request.onsuccess = () => settle(request.result);
			request.onerror = () => settle(null);
		} catch {
			settle(null);
		}
	});
}

/**
 * One transaction, promisified; resolves null on any failure. It answers when
 * the transaction commits, not when its request succeeds: a full disk aborts
 * the commit after the put said yes (#4600), and a sample that never reached
 * the disk is not a kept one.
 */
function tx<T>(
	db: IDBDatabase,
	mode: IDBTransactionMode,
	run: (samples: IDBObjectStore, rides: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
	return new Promise((resolve) => {
		try {
			const t = db.transaction(['samples', 'rides'], mode);
			const request = run(t.objectStore('samples'), t.objectStore('rides'));
			t.oncomplete = () => resolve(request.result);
			t.onabort = () => resolve(null);
			t.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

/** A whole ride in the second store, as unfinishedRides reads it back. */
interface Rescued {
	meta: RideMeta;
	samples: BufferedSample[];
}

function rescue(meta: RideMeta, samples: BufferedSample[]): boolean {
	try {
		localStorage.setItem(
			RESCUE + meta.rideId,
			JSON.stringify({ meta, samples }),
		);
		return true;
	} catch {
		// No localStorage, or full: there is nowhere left to keep it.
		return false;
	}
}

function rescued(): Rescued[] {
	const out: Rescued[] = [];
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key?.startsWith(RESCUE)) continue;
			try {
				const ride = JSON.parse(localStorage.getItem(key) ?? '') as Rescued;
				if (ride?.meta?.rideId && Array.isArray(ride.samples)) out.push(ride);
			} catch {
				// A half-written copy is no ride to offer.
			}
		}
	} catch {
		// No localStorage.
	}
	return out;
}

function unrescue(rideId: string): void {
	try {
		localStorage.removeItem(RESCUE + rideId);
	} catch {
		// Nothing to remove it from.
	}
}

export interface RideBuffer {
	/**
	 * Whether the ride is actually being kept on this device (#1466 finding
	 * 4). False means neither store took it — IndexedDB would not open, hung,
	 * or stopped committing (a private window, site data blocked, a full disk,
	 * #4600), and localStorage refused the copy too — so a crash now loses
	 * the ride. Read it again as the ride goes: a store can fail mid-ride.
	 */
	readonly crashSafe: boolean;
	append(sample: BufferedSample): void;
	/**
	 * Writes the whole ride as it ended, in one go (#4600): what a failed save
	 * leaves to recover must be every second the rider saw, whatever the
	 * appends managed. True once one of the two stores has it all.
	 */
	keep(
		samples: BufferedSample[],
		ended?: Pick<RideMeta, 'drive' | 'refused'>,
	): Promise<boolean>;
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
	/** The workout changed mid-ride (#4257): a recovered ride saves as this. */
	retitle(workout: Pick<RideMeta, 'workoutName' | 'workoutJson'>): void;
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
	let db = await open();
	// The meta row is the ride: unwritten, nothing would ever offer it back.
	if (db && (await tx(db, 'readwrite', (_, rides) => rides.put(meta))) === null)
		db = null;
	if (db) await prune(db);
	const release = hold(RECORDING + meta.rideId);
	let kept = meta;
	// The ride as appended, for the second store once the first one fails
	// (#4600). A few hundred kB for three hours.
	const appended: BufferedSample[] = [];
	let stored = db !== null;
	let rescuedOk = false;
	const toRescue = () => {
		rescuedOk = rescue(kept, appended);
		return rescuedOk;
	};
	const lost = () => {
		if (!stored) return;
		stored = false;
		toRescue();
	};
	if (!stored) toRescue();
	return {
		get crashSafe() {
			return stored || rescuedOk;
		},
		append(sample) {
			appended.push(sample);
			if (!stored) {
				if (appended.length % RESCUE_EVERY === 0) toRescue();
				return;
			}
			void tx(db!, 'readwrite', (samples) =>
				samples.put({ ...sample, rideId: meta.rideId }),
			).then((done) => done === null && lost());
		},
		async keep(samples, ended) {
			kept = { ...kept, ...ended };
			// The rows past what the appends wrote, and theirs again: a put
			// over a row is the same row.
			if (stored) {
				const done = await tx(db!, 'readwrite', (store, rides) => {
					for (const sample of samples)
						store.put({ ...sample, rideId: meta.rideId });
					return rides.put(kept);
				});
				if (done !== null) return true;
				stored = false;
			}
			appended.splice(0, appended.length, ...samples);
			return toRescue();
		},
		end() {
			unrescue(meta.rideId);
			if (!db) return release();
			// Let go once the mark is written, or another tab could find the
			// ride neither held nor ended in between and offer it back.
			void tx(db, 'readwrite', (_, rides) =>
				rides.put({ ...kept, endedAt: Date.now() }),
			).then(release);
		},
		release() {
			// What the second store has is the ride up to now, not to the
			// last checkpoint.
			if (!stored) toRescue();
			release();
		},
		retitle(workout) {
			kept = { ...kept, ...workout };
			if (stored) void tx(db!, 'readwrite', (_, rides) => rides.put(kept));
			else toRescue();
		},
		async since(seq) {
			if (!stored) return appended.filter((s) => s.seq > seq);
			// The rows past `seq` and no others (#2839): reading the whole
			// ride to filter it made every reconnect cost the ride's length.
			const rows = await tx(db!, 'readonly', (samples) =>
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
	const held = await recording();
	const mine = (ride: RideMeta) =>
		!(ride.ownerId && ride.ownerId !== ownerId) &&
		// Still being recorded, here or in another tab: not a crash (#2617).
		!held.has(RECORDING + ride.rideId);
	const found = new Map<string, RideMeta & { samples: BufferedSample[] }>();
	const ended = new Set<string>();
	for (const ride of db ? await allRides(db) : []) {
		if (ride.endedAt) ended.add(ride.rideId);
		if (ride.endedAt || !mine(ride)) continue;
		const samples = await readSamples(db!, ride.rideId);
		found.set(ride.rideId, { ...ride, samples });
	}
	// The second store's copy (#4600), where the first has none or less of it.
	for (const { meta, samples } of rescued()) {
		if (ended.has(meta.rideId)) unrescue(meta.rideId);
		else if (Date.now() - meta.startedAt > KEEP_UNSAVED_MS)
			unrescue(meta.rideId);
		else if (
			mine(meta) &&
			samples.length > (found.get(meta.rideId)?.samples.length ?? -1)
		)
			found.set(meta.rideId, { ...meta, samples });
	}
	return [...found.values()].filter((r) => r.samples.length >= MinRideSamples);
}

/**
 * One ride's seconds, ended or not, while the prune has not taken them (#4262):
 * a save the server refused ended its ride, and its summary on Rides is the
 * way back to them. The rider's own only, as unfinishedRides keeps it.
 */
export async function bufferedRide(
	rideId: string,
	ownerId: string,
): Promise<(RideMeta & { samples: BufferedSample[] }) | null> {
	const db = await open();
	const stored = db
		? ((await tx(db, 'readonly', (_, rides) => rides.get(rideId))) as
				RideMeta | null | undefined)
		: null;
	let ride = stored && { ...stored, samples: await readSamples(db!, rideId) };
	const copy = rescued().find((r) => r.meta.rideId === rideId);
	if (copy && copy.samples.length > (ride?.samples.length ?? -1))
		ride = { ...copy.meta, samples: copy.samples };
	if (!ride || (ride.ownerId && ride.ownerId !== ownerId)) return null;
	return ride.samples.length >= MinRideSamples ? ride : null;
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
	for (const { meta } of rescued())
		if (meta.ownerId === ownerId) unrescue(meta.rideId);
	const db = await open();
	if (!db) return;
	for (const ride of await allRides(db))
		if (ride.ownerId === ownerId) await discard(db, ride.rideId);
}

/** The server refused the ride for good (#4600): nothing sends it again. */
export async function refuseRide(
	rideId: string,
	message: string,
): Promise<void> {
	const copy = rescued().find((r) => r.meta.rideId === rideId);
	if (copy) rescue({ ...copy.meta, refused: message }, copy.samples);
	const db = await open();
	if (!db) return;
	const ride = (await tx(db, 'readonly', (_, rides) => rides.get(rideId))) as
		RideMeta | null | undefined;
	if (ride)
		await tx(db, 'readwrite', (_, rides) =>
			rides.put({ ...ride, refused: message }),
		);
}

export async function discardRide(rideId: string): Promise<void> {
	unrescue(rideId);
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
 * KEEP_RIDES stay. Past them a finished ride or a fragment goes. A ride the
 * server never confirmed is the rider's until the account has it: it stays,
 * however many rides came after, for KEEP_UNSAVED_MS (#4600) — every session
 * joined opens a buffer, and a count once walked a failed solo save off the
 * end (#794, audit 2026-09-09).
 */
export function stale(
	rides: Array<RideMeta & { samples: number }>,
	now = Date.now(),
): string[] {
	const out: string[] = [];
	[...rides]
		.sort((a, b) => b.startedAt - a.startedAt)
		.forEach((ride, i) => {
			const recoverable = !ride.endedAt && ride.samples >= MinRideSamples;
			if (
				recoverable ? now - ride.startedAt > KEEP_UNSAVED_MS : i >= KEEP_RIDES
			)
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
