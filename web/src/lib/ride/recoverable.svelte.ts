import { account } from '$lib/account.svelte';
import { unfinishedRides } from '$lib/ride/buffer';
import type { RecoveredRide } from '$lib/ride/recovered';

/**
 * The signed-in rider's unfinished rides, for the card that offers them back
 * and the notice that counts them (#2805). Asked again whenever the account
 * changes, and empty while nobody is signed in: a session cookie that expires
 * or a second sign-in over the first changes who is here without a sign-out
 * ever running, so the question is who is signed in now, not what was cleared.
 *
 * Called while a component initialises — it owns an effect.
 */
export function recoverableRides() {
	let rides = $state<RecoveredRide[]>([]);
	$effect(() => {
		const owner = account.me?.id;
		rides = [];
		if (!owner) return;
		let current = true;
		void unfinishedRides(owner).then((found) => {
			if (current) rides = found;
		});
		return () => {
			current = false;
		};
	});
	return {
		get all(): RecoveredRide[] {
			return rides;
		},
		/** The ride left the card — saved, downloaded or discarded. */
		drop(rideId: string) {
			rides = rides.filter((r) => r.rideId !== rideId);
		},
	};
}
