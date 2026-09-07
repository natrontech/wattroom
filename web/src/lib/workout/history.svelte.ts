/**
 * Undo and redo for the workout editor (#1005).
 *
 * The sheet is a few kilobytes of JSON living in local state until Save, so the
 * history is a stack of whole snapshots — no diffing, no command objects, no
 * per-mutation bookkeeping at the call sites. The editor records after every
 * change; this module decides whether that is a new entry, the same field still
 * being typed, or nothing worth keeping.
 */
import type { Workout } from './types';

export interface Snapshot {
	workout: Workout;
	/** Selection travels with the sheet, so undoing a delete reselects what came back. */
	selected: number[] | null;
}

// ponytail: 100 whole snapshots of a workout is well under a megabyte and
// deeper than anyone reaches by hand. The cap exists so a long session cannot
// grow without bound, not because 100 is a meaningful number.
const LIMIT = 100;

/** Two edits to the same field closer together than this are one undo step. */
const COALESCE_MS = 600;

const copy = (snapshot: Snapshot): Snapshot => ({
	workout: JSON.parse(JSON.stringify(snapshot.workout)) as Workout,
	selected: snapshot.selected ? [...snapshot.selected] : null,
});

/**
 * The leaves that differ between two values, as dotted paths. Stops once it has
 * two: the only question asked is "was this exactly one field, and which one" —
 * typing in a duration changes `steps.0.seconds` over and over, while deleting a
 * step shifts everything after it and is never one path.
 */
export function changedPaths(
	a: unknown,
	b: unknown,
	at = '',
	found: string[] = [],
): string[] {
	if (found.length > 1 || a === b) return found;
	if (
		a === null ||
		b === null ||
		typeof a !== 'object' ||
		typeof b !== 'object'
	) {
		found.push(at);
		return found;
	}
	const keys = new Set([
		...Object.keys(a as object),
		...Object.keys(b as object),
	]);
	for (const key of keys) {
		changedPaths(
			(a as Record<string, unknown>)[key],
			(b as Record<string, unknown>)[key],
			at ? `${at}.${key}` : key,
			found,
		);
		if (found.length > 1) break;
	}
	return found;
}

export function createHistory(first: Snapshot, now: () => number = Date.now) {
	let entries = $state<Snapshot[]>([copy(first)]);
	let at = $state(0);
	/** The field the open entry is about, and when it was last touched. */
	let openPath: string | null = null;
	let openAt = 0;

	return {
		get canUndo(): boolean {
			return at > 0;
		},
		get canRedo(): boolean {
			return at < entries.length - 1;
		},

		/** Called after every change to the sheet. Unchanged sheets record nothing. */
		record(next: Snapshot): void {
			const changed = changedPaths(entries[at].workout, next.workout);
			if (changed.length === 0) return;
			const path = changed.length === 1 ? changed[0] : null;
			const t = now();
			if (path !== null && path === openPath && t - openAt < COALESCE_MS) {
				entries[at] = copy(next);
				openAt = t;
				return;
			}
			// A new edit is the end of the line: whatever was redoable is gone.
			entries = [...entries.slice(0, at + 1), copy(next)].slice(-LIMIT);
			at = entries.length - 1;
			openPath = path;
			openAt = t;
		},

		undo(): Snapshot | null {
			if (at === 0) return null;
			at -= 1;
			// The next edit starts its own entry rather than merging into the one
			// we just stepped off.
			openPath = null;
			return copy(entries[at]);
		},

		redo(): Snapshot | null {
			if (at >= entries.length - 1) return null;
			at += 1;
			openPath = null;
			return copy(entries[at]);
		},

		/** Starts over from `snapshot` — a saved workout arriving is not an edit. */
		reset(snapshot: Snapshot): void {
			entries = [copy(snapshot)];
			at = 0;
			openPath = null;
		},
	};
}
