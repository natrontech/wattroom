import { goto } from '$app/navigation';
import { untrack } from 'svelte';
import { channelAddress, type PlaceAddress } from '#lib/channel/address.ts';
import { askVoice, type CallNow } from '#lib/channel/voice-intent.ts';
import { toasts } from '#lib/toast.svelte.ts';
import type { Moved } from '#lib/protocol.ts';

/**
 * Moved by the crew's owner or an admin (#2730, Discord's drag): go where
 * they put you, the way a sidebar click goes (#2702). A live mic and camera
 * come along; a rider who was only on the page arrives without joining
 * voice. A ride comes along too, still running (#4259). Call inside the
 * connection's effect root.
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
