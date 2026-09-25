/**
 * The device-only leftovers of ride history (#14, then #110): summaries the
 * server refused — under a minute — or never received because it was
 * unreachable when the ride ended. Every ride the server took lives on the
 * account; this store holds what could not move there.
 *
 * Stores the summary rather than the samples: a full 1 Hz recording of an hour is
 * ~3600 entries, and localStorage is a few megabytes shared with everything else.
 * The .fit is the artefact worth keeping, and the rider downloads that.
 */
const KEY = 'wattroom.history.v1';
const MAX_ENTRIES = 200;

export interface RideRecord {
	id: string;
	/**
	 * The account that rode it (#2805): a summary is its rider's, and the next
	 * one signing in on this browser does not see it. Absent on a summary kept
	 * before it, which stays listed — it names nobody, and holds no heart rate.
	 */
	ownerId?: string;
	workoutName: string;
	/** ISO 8601 */
	startedAt: string;
	seconds: number;
	kj: number;
	avgWatts: number;
	execution: number;
	/** #1143: false when the workout prescribed nothing to score. */
	executionScored?: boolean;
	ftp: number;
}

function parse(value: unknown): RideRecord[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry !== 'object' || entry === null) return [];
		const r = entry as Record<string, unknown>;
		if (typeof r.id !== 'string' || typeof r.startedAt !== 'string') return [];
		if (typeof r.seconds !== 'number' || typeof r.avgWatts !== 'number')
			return [];
		return [
			{
				id: r.id,
				...(typeof r.ownerId === 'string' ? { ownerId: r.ownerId } : {}),
				workoutName: typeof r.workoutName === 'string' ? r.workoutName : 'Ride',
				startedAt: r.startedAt,
				seconds: r.seconds,
				kj: typeof r.kj === 'number' ? r.kj : 0,
				avgWatts: r.avgWatts,
				execution: typeof r.execution === 'number' ? r.execution : 0,
				// Absent on a ride saved before #1143 — those all had a score.
				executionScored: r.executionScored !== false,
				ftp: typeof r.ftp === 'number' ? r.ftp : 0,
			},
		];
	});
}

export function summarise(samples: { watts: number }[]): {
	seconds: number;
	kj: number;
	avgWatts: number;
} {
	if (samples.length === 0) return { seconds: 0, kj: 0, avgWatts: 0 };
	const total = samples.reduce((sum, s) => sum + s.watts, 0);
	return {
		seconds: samples.length,
		// Floored, as the server stores it (integer division) — XP derives
		// from it on both sides, so the two must agree (#1544).
		kj: Math.floor(total / 1000),
		avgWatts: Math.round(total / samples.length),
	};
}

function read(): RideRecord[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? parse(JSON.parse(raw)) : [];
	} catch {
		return [];
	}
}

/** Returns false when the browser would not take the write. */
function write(rides: RideRecord[]): boolean {
	try {
		if (rides.length) localStorage.setItem(KEY, JSON.stringify(rides));
		else localStorage.removeItem(KEY);
		return true;
	} catch {
		return false;
	}
}

/**
 * The summaries an account left in this browser go with the account (#2805):
 * the device half of deleting it.
 */
export function forgetHistoryOf(ownerId: string): void {
	write(read().filter((r) => r.ownerId !== ownerId));
}

/**
 * The signed-in rider's device summaries. `owner` is asked on every read, so
 * a different account signing in sees its own list, not the one it found.
 */
export function createHistoryStore(owner: () => string | undefined) {
	let rides = $state<RideRecord[]>(read());
	const mine = (r: RideRecord) => !r.ownerId || r.ownerId === owner();

	return {
		get all(): RideRecord[] {
			return rides
				.filter(mine)
				.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		},
		add(record: RideRecord): string | null {
			// Oldest first out: a rider cares about this week, and the cap keeps the
			// key well under any browser's quota.
			const next = [{ ...record, ownerId: owner() }, ...rides].slice(
				0,
				MAX_ENTRIES,
			);
			if (!write(next))
				return 'Could not save this ride — local storage is full or blocked.';
			rides = next;
			return null;
		},
		/** The ride reached the account after all (#1544): one copy, there. */
		remove(id: string): void {
			const next = rides.filter((r) => r.id !== id || !mine(r));
			if (next.length === rides.length) return;
			// The account copy exists either way.
			write(next);
			rides = next;
		},
		/** Clears this rider's list; another account's summaries stay theirs. */
		clear(): void {
			// Nothing to do on a refusal — the list is already gone from view.
			const next = rides.filter((r) => !mine(r));
			write(next);
			rides = next;
		},
	};
}
