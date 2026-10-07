import { goto } from '$app/navigation';
import type { ChannelContext } from '$lib/channel/context';
import type { LiveRider } from '$lib/channel/types';
import { personMenu } from '$lib/person-menu';

/** A crewmate's right-click menu, wherever the crew is drawn (ux.md: right-click). */
export const crewMenu = (channel: ChannelContext, rider: LiveRider) =>
	personMenu(rider.id, goto, {
		you: rider.you,
		handoff: channel.handOffOf(rider.id, rider.name),
	});
