import type { MenuEntry } from '$lib/context-menu.svelte';
import { deleteRideAfterConfirm } from './delete-ride';
import type { ServerRide } from './list';
import { setRideShared, shareAction } from './share';
import Lock from '@lucide/svelte/icons/lock';
import Trash2 from '@lucide/svelte/icons/trash-2';
import Users from '@lucide/svelte/icons/users';

/**
 * A ride row's verbs, as menu items (#486) — the history list's rows and
 * Home's recent three (#2171), which is the same ride on another surface and
 * had no menu at all. Delete opens the confirm rather than acting: unlike
 * sharing, it cannot be handed back by an undo toast (errors.md).
 *
 * `onDeleted` is how the caller's own list forgets the ride; a refused or
 * cancelled delete never calls it.
 */
export function rideRowMenu(
	ride: ServerRide,
	onDeleted?: (ride: ServerRide) => void,
): MenuEntry[] {
	return [
		{
			label: shareAction(ride.sharedWithFriends).label,
			icon: ride.sharedWithFriends ? Lock : Users,
			onSelect: () => void setRideShared(ride, !ride.sharedWithFriends),
		},
		'separator',
		{
			label: 'Delete ride',
			icon: Trash2,
			danger: true,
			onSelect: () =>
				void deleteRideAfterConfirm(ride).then(
					(gone) => gone && onDeleted?.(ride),
				),
		},
	];
}
