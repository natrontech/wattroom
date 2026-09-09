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
		kj: Math.round(total / 1000),
		avgWatts: Math.round(total / samples.length),
	};
}

export function createHistoryStore() {
	let rides = $state<RideRecord[]>(read());

	function read(): RideRecord[] {
		if (typeof localStorage === 'undefined') return [];
		try {
			const raw = localStorage.getItem(KEY);
			return raw ? parse(JSON.parse(raw)) : [];
		} catch {
			return [];
		}
	}

	return {
		get all(): RideRecord[] {
			return [...rides].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		},
		add(record: RideRecord): string | null {
			// Oldest first out: a rider cares about this week, and the cap keeps the
			// key well under any browser's quota.
			const next = [record, ...rides].slice(0, MAX_ENTRIES);
			try {
				localStorage.setItem(KEY, JSON.stringify(next));
			} catch {
				return 'Could not save this ride — local storage is full or blocked.';
			}
			rides = next;
			return null;
		},
		clear(): void {
			try {
				localStorage.removeItem(KEY);
			} catch {
				/* nothing to do — the list is already gone from view */
			}
			rides = [];
		},
	};
}
