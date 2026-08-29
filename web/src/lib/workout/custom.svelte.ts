import type { Workout } from './types';
import { validateWorkout } from './validate';

/**
 * Rider-authored workouts, stored locally until there is a database (#15).
 *
 * The stored shape is deliberately the SPEC `Workout` plus an id, so migrating to
 * Postgres is an insert rather than a translation.
 *
 * Every read is validated. localStorage is hand-editable, survives across app
 * versions, and can come back empty or throw outright (private windows, blocked
 * site data) — so this never assumes a read succeeds and never trusts what it gets.
 */
const KEY = 'wattroom.workouts.v1';

export interface CustomWorkout {
	id: string;
	workout: Workout;
	/** ms epoch, for ordering newest-first. */
	savedAt: number;
}

function read(): CustomWorkout[] {
	if (typeof localStorage === 'undefined') return [];
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(KEY);
	} catch {
		return []; // blocked site data — the app works, custom workouts just do not persist
	}
	if (!raw) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	// Drop entries that no longer validate rather than failing the whole read: one
	// corrupt workout should not cost a rider the rest of their library.
	return parsed.flatMap((entry) => {
		if (typeof entry !== 'object' || entry === null) return [];
		const { id, workout, savedAt } = entry as Record<string, unknown>;
		if (typeof id !== 'string' || !id) return [];
		const result = validateWorkout(workout);
		if (!result.ok) return [];
		return [
			{
				id,
				workout: result.workout,
				savedAt: typeof savedAt === 'number' ? savedAt : 0,
			},
		];
	});
}

function write(entries: CustomWorkout[]): string | null {
	try {
		localStorage.setItem(KEY, JSON.stringify(entries));
		return null;
	} catch {
		// Quota, or a browser refusing storage. Say so rather than pretending it saved.
		return 'Could not save — this browser is not allowing local storage.';
	}
}

/** Stable, readable, and collision-free enough for a per-device list. */
function makeId(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 40);
	return `${slug || 'workout'}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createCustomStore() {
	let entries = $state<CustomWorkout[]>(read());

	return {
		get all(): CustomWorkout[] {
			return [...entries].sort((a, b) => b.savedAt - a.savedAt);
		},
		byId(id: string): CustomWorkout | undefined {
			return entries.find((entry) => entry.id === id);
		},
		/** Returns an error message, or null on success. */
		save(workout: Workout, id?: string): { id: string; error: string | null } {
			const result = validateWorkout(workout);
			if (!result.ok) return { id: id ?? '', error: result.error };

			const savedAt = Date.now();
			const nextId = id ?? makeId(workout.name);
			const next = entries.some((entry) => entry.id === nextId)
				? entries.map((entry) =>
						entry.id === nextId
							? { id: nextId, workout: result.workout, savedAt }
							: entry,
					)
				: [...entries, { id: nextId, workout: result.workout, savedAt }];

			const error = write(next);
			if (!error) entries = next;
			return { id: nextId, error };
		},
		remove(id: string): string | null {
			const next = entries.filter((entry) => entry.id !== id);
			const error = write(next);
			if (!error) entries = next;
			return error;
		},
	};
}
