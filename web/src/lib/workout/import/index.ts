import { validateWorkout } from '../validate';
import { parseErg } from './erg';
import type { ImportOutcome } from './types';
import { parseZwo } from './zwo';

export type { Imported, ImportOutcome } from './types';

/**
 * Bringing an existing plan in (#2327). A rider who already has a coach, a
 * head unit and a training plan retypes it block by block today, or does not
 * come; this turns their file into an ordinary WattRoom workout.
 *
 * The whole conversion runs in the browser, which is where the file already
 * is. Nothing here is a second workout format and nothing here is a new
 * boundary: the result goes to the shelf through `POST /api/workouts`, which
 * bounds it server-side exactly as the editor's Save does.
 */

/** What the file picker and the drop zone accept. */
export const IMPORT_EXTENSIONS = ['.zwo', '.erg'] as const;

/**
 * A megabyte, so a hostile or mistaken pick is refused before it is read
 * rather than after. It is two orders of magnitude above the largest real
 * file this takes: a four-hour .erg written one row per second is under
 * 200 KB, and a .zwo is a few KB whatever it prescribes.
 */
export const MAX_IMPORT_BYTES = 1024 * 1024;

function stemOf(fileName: string): string {
	const base = fileName.split(/[\\/]/).pop() ?? fileName;
	const dot = base.lastIndexOf('.');
	return (dot > 0 ? base.slice(0, dot) : base).trim();
}

function extensionOf(fileName: string): string {
	const base = fileName.split(/[\\/]/).pop() ?? fileName;
	const dot = base.lastIndexOf('.');
	return dot < 0 ? '' : base.slice(dot).toLowerCase();
}

/**
 * `riderFtp` only matters to a `.erg` that ramps in watts and states no FTP
 * of its own — see parseErg. Pass the rider's real FTP or null; never a
 * stand-in, because the number ends up in the workout they save.
 */
export function importWorkout(
	fileName: string,
	source: string,
	riderFtp: number | null,
): ImportOutcome {
	const extension = extensionOf(fileName);
	const stem = stemOf(fileName) || 'Imported workout';
	// The kind of file comes first: a rider who picked the wrong one wants to
	// hear that, not that the wrong one happened to be empty.
	if (!(IMPORT_EXTENSIONS as readonly string[]).includes(extension)) {
		return {
			ok: false,
			error: `WattRoom reads ${IMPORT_EXTENSIONS.join(' and ')} workout files. “${fileName}” is neither.`,
		};
	}
	if (source.trim() === '') return { ok: false, error: 'That file is empty.' };

	const outcome =
		extension === '.zwo'
			? parseZwo(source, stem)
			: parseErg(source, stem, riderFtp);
	if (!outcome.ok) return outcome;

	// The same gate the editor's Save and the shelf's every read run: bounds
	// and step types come from docs/SPEC.md, never from the source file, so a
	// block outside them is a refusal with a reason rather than a workout the
	// engine will not run.
	const checked = validateWorkout(outcome.imported.workout);
	if (!checked.ok)
		return {
			ok: false,
			error: `That file converted, but the result is not a workout WattRoom can ride. ${checked.error}.`,
		};
	return outcome;
}

/** Reads the picked file, bounded, and converts it. */
export async function importWorkoutFile(
	file: File,
	riderFtp: number | null,
): Promise<ImportOutcome> {
	if (file.size > MAX_IMPORT_BYTES)
		return {
			ok: false,
			error: `“${file.name}” is ${Math.round(file.size / 1024)} KB. A workout file is a few kilobytes; this reads up to ${MAX_IMPORT_BYTES / 1024} KB.`,
		};
	let source: string;
	try {
		source = await file.text();
	} catch {
		return {
			ok: false,
			error: `“${file.name}” could not be read. Copy it somewhere local and pick it again.`,
		};
	}
	return importWorkout(file.name, source, riderFtp);
}
