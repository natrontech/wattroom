import { goto } from '$app/navigation';
import { untrack } from 'svelte';
import { channelAddress, type PlaceAddress } from '$lib/channel/address';
import { askVoice, type CallNow } from '$lib/channel/voice-intent';
import { toasts } from '$lib/toast.svelte';
import type { Moved } from '$lib/protocol';

/**
 * Moved by the crew's owner or an admin (#2730, Discord's drag): go where
 * they put you, the way a sidebar click goes (#2702). A live mic and camera
 * come along; a rider who was only on the page arrives without joining
 * voice. A session ride still asks first, because the navigation passes
 * ride-guard like any other. Call inside the connection's effect root.
 */
export function followMoves({
	address,
	live,
	av,
}: {
	address: PlaceAddress;
	live: { readonly lastMove: Moved | null };
	av: CallNow;
}): void {
	$effect(() => {
		const moved = live.lastMove;
		if (!moved) return;
		untrack(() => {
			const to = channelAddress(address.crew, moved.channel, moved.name);
			if (av.status === 'live') askVoice(to.key, av, Date.now());
			toasts.push(`${moved.by} moved you to ${moved.name}.`);
			void goto(to.home);
		});
	});
}
