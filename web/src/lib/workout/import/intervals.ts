import { api } from '$lib/api';
import { importWorkout } from './index';
import type { ImportOutcome } from './types';

/**
 * The rider's planned week from intervals.icu (#2327, decided 2026-09-29):
 * the server makes one OAuth round trip scoped to the calendar, reads the
 * next seven days of planned workouts as .zwo, keeps no access, and lands
 * the rider back on /workouts/import with a one-time pull. Each workout
 * then goes through the same importer a picked file does.
 */

/** One planned workout as the server hands it over. */
export interface PlannedWorkout {
	name: string;
	date: string;
	zwo: string;
}

/** A pull that brought nothing back, by where the callback landed it. */
export const PULL_OUTCOMES: Record<string, string> = {
	denied:
		'Nothing was pulled: intervals.icu was not given access to your calendar.',
	failed: 'intervals.icu did not answer the pull. Try again in a minute.',
	expired:
		'That pull took too long or started in another tab. Pull again from here.',
};

export type PullResult =
	| { ok: true; workouts: PlannedWorkout[]; skipped: number }
	| { ok: false; error: string };

/** Whether this server has an intervals.icu client at all. */
export async function intervalsAvailable(): Promise<boolean> {
	const res = await api<{ available: boolean }>('/api/intervals');
	return res.ok && res.data.available;
}

/** The pull the callback landed with: its workouts, once, or why not. */
export async function openPull(landing: string): Promise<PullResult> {
	if (landing in PULL_OUTCOMES)
		return { ok: false, error: PULL_OUTCOMES[landing] };
	const res = await api<{ workouts: PlannedWorkout[]; skipped: number }>(
		`/api/intervals/pulls/${encodeURIComponent(landing)}`,
	);
	return res.ok
		? { ok: true, workouts: res.data.workouts, skipped: res.data.skipped }
		: { ok: false, error: res.error.message };
}

/** A planned workout through the importer, as the .zwo it arrived as. */
export function importPlanned(
	planned: PlannedWorkout,
	riderFtp: number | null,
): ImportOutcome {
	// The name becomes the file's stem, so nothing in it may read as a path.
	const stem =
		planned.name.replaceAll(/[\\/]/g, '-').trim() || 'Planned workout';
	return importWorkout(`${stem}.zwo`, planned.zwo, riderFtp);
}
