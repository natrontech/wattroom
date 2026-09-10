import { confirm } from '$lib/confirm.svelte';
import { toasts } from '$lib/toast.svelte';
import { deleteRide } from './detail';

/**
 * One of errors.md's confirm cases, not an undo toast: a ride's samples are
 * kept nowhere else, so nothing can put one back. Asked on the house dialog
 * (#2003): the ride's own Modal used to put the danger button first in the
 * DOM, so an Enter arriving as it mounted deleted the ride. Resolves to
 * whether the ride is gone; a refusal is a toast, and the caller keeps its
 * list.
 */
export async function deleteRideAfterConfirm(ride: {
	id: string;
	workoutName: string;
	startedAt: string;
}): Promise<boolean> {
	const ok = await confirm({
		title: 'Delete this ride?',
		body: `“${ride.workoutName}”, ${new Date(ride.startedAt).toLocaleDateString()} — its power trace, its medals and its XP go with it. This one can't be undone.`,
		action: 'Delete ride',
		cancel: 'Keep it',
	});
	if (!ok) return false;
	const res = await deleteRide(ride.id);
	if (!res.ok) {
		toasts.push(res.error.message);
		return false;
	}
	toasts.push(`“${ride.workoutName}” is gone.`);
	return true;
}
