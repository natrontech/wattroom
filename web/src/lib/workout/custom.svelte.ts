import { api } from '$lib/api';
import type { Workout } from './types';
import { validateWorkout } from './validate';

/**
 * Rider-authored workouts, on the account since the login gate (ADR-0009):
 * the editor talks to /api/workouts, so a workout built on the desktop
 * exists on the laptop. localStorage remains only as the pre-account
 * shelf, imported once and then cleared.
 *
 * Every read is validated — the server bounds-checks, but the definition is
 * still data crossing a boundary, and one corrupt workout must not cost the
 * rest of the shelf.
 */
const LEGACY_KEY = 'wattroom.workouts.v1';

export interface CustomWorkout {
	id: string;
	workout: Workout;
	/** ms epoch, for ordering newest-first. */
	savedAt: number;
}

function parseEntry(value: unknown): CustomWorkout | null {
	if (typeof value !== 'object' || value === null) return null;
	const { id, workout, savedAt } = value as Record<string, unknown>;
	if (typeof id !== 'string' || !id) return null;
	const result = validateWorkout(workout);
	if (!result.ok) return null;
	return {
		id,
		workout: result.workout,
		savedAt: typeof savedAt === 'number' ? savedAt : 0,
	};
}

/** The pre-account localStorage shelf, validated; junk entries dropped. */
function readLegacy(): CustomWorkout[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(LEGACY_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((entry) => parseEntry(entry) ?? []);
	} catch {
		return [];
	}
}

export function createCustomStore() {
	let entries = $state<CustomWorkout[]>([]);
	let loaded = $state(false);
	// Why the last read failed, until one succeeds: a shelf that could not
	// be read is not an empty shelf (errors.md), and every surface that draws
	// it used to say "nothing yet" (audit 2026-09-09).
	let error = $state<string | null>(null);
	// Entries the server holds that this client refused to read — a shape
	// from an older version, or written through the API before the server
	// bounded steps (#1393). Counted and said, never silently eaten.
	let dropped = $state(0);
	// docs/SPEC.md's shelf ceiling, as the server reports it (#1414) — never
	// a second copy of the number here. 0 until the first read answers, which
	// reads as "no ceiling known yet" and gates nothing.
	let max = $state(0);

	// The shelf is paged (#1414): the server answers 100 at a time and hands
	// back the cursor for the next page, so a rider whose shelf predates the
	// 200-workout ceiling still sees all of it. Every page or none — a
	// half-read shelf shown as the whole shelf is the silent hiding the
	// paging exists to end.
	const MAX_PAGES = 20;

	async function refresh(): Promise<void> {
		const collected: unknown[] = [];
		let query = '';
		for (let page = 0; page < MAX_PAGES; page++) {
			const res = await api<{
				workouts: unknown[];
				more?: boolean;
				nextBefore?: string;
				nextBeforeId?: string;
				max?: number;
			}>(`/api/workouts${query}`);
			if (!res.ok) {
				error = res.error.message;
				loaded = true;
				return;
			}
			// data can be null on a malformed body — the shelf shows empty, not a crash
			collected.push(...(res.data?.workouts ?? []));
			const { more, nextBefore, nextBeforeId } = res.data ?? {};
			max = res.data?.max ?? max;
			if (!more || !nextBefore || !nextBeforeId) break;
			query = `?before=${encodeURIComponent(nextBefore)}&beforeId=${encodeURIComponent(nextBeforeId)}`;
		}
		entries = collected.flatMap((entry) => parseEntry(entry) ?? []);
		dropped = collected.length - entries.length;
		error = null;
		loaded = true;
	}

	// One-time import: everything that was on this device moves to the
	// account; only what actually landed is removed, so a failed upload
	// retries on the next visit instead of vanishing.
	async function migrate(): Promise<void> {
		const legacy = readLegacy();
		if (legacy.length === 0) return;
		const stranded: CustomWorkout[] = [];
		for (const entry of legacy) {
			const res = await api<{ id: string }>('/api/workouts', {
				method: 'POST',
				json: { workout: entry.workout },
			});
			if (!res.ok) stranded.push(entry);
		}
		try {
			if (stranded.length === 0) localStorage.removeItem(LEGACY_KEY);
			else localStorage.setItem(LEGACY_KEY, JSON.stringify(stranded));
		} catch {
			// storage refusing writes cannot strand data that already uploaded
		}
	}

	void migrate().then(refresh);

	return {
		/** False until the first fetch answers — screens hold their skeletons on it. */
		get loaded(): boolean {
			return loaded;
		},
		/** The last read's failure, or null; `retry()` reads again. */
		get error(): string | null {
			return error;
		},
		/** Saved workouts this version could not read, and does not show. */
		get dropped(): number {
			return dropped;
		},
		/** docs/SPEC.md's ceiling, as the server reports it; 0 until loaded. */
		get max(): number {
			return max;
		},
		/**
		 * True when a new save would be refused with a 429. Editing an
		 * existing workout is never refused, so only the surfaces that create
		 * one gate on this.
		 */
		get full(): boolean {
			return max > 0 && entries.length + dropped >= max;
		},
		retry: refresh,
		get all(): CustomWorkout[] {
			return [...entries].sort((a, b) => b.savedAt - a.savedAt);
		},
		byId(id: string): CustomWorkout | undefined {
			return entries.find((entry) => entry.id === id);
		},
		/** Returns the new id, or an error message the caller shows. */
		async save(
			workout: Workout,
			id?: string,
		): Promise<{ id: string; error: string | null }> {
			const result = validateWorkout(workout);
			if (!result.ok) return { id: id ?? '', error: result.error };
			const res = await api<{ id: string }>(
				id ? `/api/workouts/${id}` : '/api/workouts',
				{ method: id ? 'PUT' : 'POST', json: { workout: result.workout } },
			);
			if (!res.ok) return { id: id ?? '', error: res.error.message };
			await refresh();
			return { id: res.data.id, error: null };
		},
		/** Returns an error message, or null. */
		async remove(id: string): Promise<string | null> {
			const res = await api(`/api/workouts/${id}`, { method: 'DELETE' });
			if (!res.ok) return res.error.message;
			await refresh();
			return null;
		},
	};
}

// One shelf per app, not per surface (#1711): four surfaces each built their
// own store, each re-running the legacy migration — two alive at once
// uploaded the same workouts twice — and each fetching the shelf again.
let shared: ReturnType<typeof createCustomStore> | null = null;
export function customWorkouts(): ReturnType<typeof createCustomStore> {
	return (shared ??= createCustomStore());
}
