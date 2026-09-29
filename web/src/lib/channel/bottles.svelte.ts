import { account } from '$lib/account.svelte';
import type { PlaceAddress } from '$lib/channel/address';
import type { createChannelLive } from '$lib/channel/live.svelte';
import { announce } from '$lib/messages/announce';
import { bottleArrival, inRecoveryValley, type Effort } from '$lib/roadside';
import { toasts } from '$lib/toast.svelte';
import { untrack } from 'svelte';

/**
 * Bottles handed up to this rider from the roadside (#3022, ADR-0064).
 *
 * A bottle is held on the rider's own screen until the ride eases into a
 * recovery valley (roadside.ts), then announced the way a poke is — the cue,
 * and a line in the timeline mid-ride. A hand reaching up in the middle of an
 * interval is the one thing a spectator must not do to a rider, so the
 * screen does the waiting rather than the rider.
 *
 * Held in memory, so a reload lets go of a bottle not yet taken: the sender
 * was told it was handed up, and nothing durable was ever promised.
 *
 * Called inside the connection's effect root, beside connectionCues.
 */
export function bottleHandUps({
	address,
	live,
	effort,
}: {
	address: PlaceAddress;
	live: Pick<ReturnType<typeof createChannelLive>, 'lastBottle' | 'tick'>;
	effort: () => Effort;
}): void {
	// Nothing renders these, so neither is $state: an effect that writes
	// state is re-run by the flush that write starts.
	const held: { fromId: string; from: string; at: number }[] = [];
	let heard: unknown = null;

	function pop() {
		for (const bottle of held.splice(0))
			announce(bottleArrival(bottle, { href: address.home }));
	}

	$effect(() => {
		const bottle = live.lastBottle;
		if (bottle === heard) return;
		heard = bottle;
		untrack(() => {
			if (!bottle?.fromId || !bottle.from || !bottle.at) return;
			// The hub hands the sender's socket its own bottle back: it landed.
			if (bottle.fromId === account.me?.id) {
				const name = live.tick?.roster?.find((r) => r.id === bottle.to)?.name;
				toasts.push(`Handed ${name ?? 'them'} a bottle.`);
				return;
			}
			held.push({ fromId: bottle.fromId, from: bottle.from, at: bottle.at });
			if (inRecoveryValley(effort())) pop();
		});
	});

	// The valley arriving is what lets them go.
	$effect(() => {
		if (inRecoveryValley(effort()) && held.length > 0) untrack(pop);
	});
}
