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

	async function refresh(): Promise<void> {
		const res = await api<{ workouts: unknown[] }>('/api/workouts');
		if (res.ok) {
			// data can be null on a malformed body — the shelf shows empty, not a crash
			entries = (res.data?.workouts ?? []).flatMap(
				(entry) => parseEntry(entry) ?? [],
			);
		}
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
