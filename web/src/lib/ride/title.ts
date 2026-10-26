import { api } from '$lib/api';
import { toasts } from '$lib/toast.svelte';
import { riddenName, type RideRoad } from './list';

/**
 * Give a finished ride a name of its own (#4209), or "" for what was ridden
 * back. Only the name moves: the workout it rode, and so Against your best,
 * keep theirs. Undo over confirm (errors.md), as sharing does: the rename
 * lands, the toast takes it back. The object is mutated in place so a $state
 * ride re-renders. Returns why it was refused, or null.
 */
export async function renameRide(
	ride: { id: string; workoutName: string; road?: RideRoad; title?: string },
	title: string,
	undoable = true,
): Promise<string | null> {
	const before = ride.title ?? '';
	const res = await api<{ title: string }>(
		`/api/rides/${encodeURIComponent(ride.id)}`,
		{ method: 'PATCH', json: { title: title.trim() } },
	);
	if (!res.ok) return res.error.message;
	ride.title = res.data.title || undefined;
	toasts.push(
		res.data.title
			? `Renamed to “${res.data.title}”.`
			: `Named “${riddenName(ride)}” again.`,
		undoable
			? {
					undo: () =>
						void renameRide(ride, before, false).then(
							(error) => error && toasts.push(error, { tone: 'error' }),
						),
				}
			: undefined,
	);
	return null;
}
