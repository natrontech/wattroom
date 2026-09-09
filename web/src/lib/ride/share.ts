import { api } from '$lib/api';
import { toasts } from '$lib/toast.svelte';

/**
 * Flip one ride's friends-visibility (ADR-0024) from wherever it is offered
 * — the list row, its menu, the ride page (#1691). Undo over confirm
 * (errors.md): the flip lands at once and the toast takes it back; a refused
 * flip reverts the row and says why. The object is mutated in place so a
 * $state row re-renders.
 */
export async function setRideShared(
	ride: { id: string; sharedWithFriends: boolean },
	shared: boolean,
	undoable = true,
): Promise<void> {
	const before = ride.sharedWithFriends;
	ride.sharedWithFriends = shared;
	const res = await api(`/api/rides/${ride.id}`, {
		method: 'PATCH',
		json: { sharedWithFriends: shared },
	});
	if (!res.ok) {
		ride.sharedWithFriends = before;
		toasts.push(res.error.message, { tone: 'error' });
		return;
	}
	toasts.push(
		shared ? 'Shared with your friends.' : 'Private again.',
		undoable
			? { undo: () => void setRideShared(ride, !shared, false) }
			: undefined,
	);
}
