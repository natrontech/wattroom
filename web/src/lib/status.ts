import type { LiveCrew, LiveOccupant } from '$lib/crews-live';
import type { Friend } from '$lib/friends/friends.svelte';

/**
 * Where a person is, in one word (#807). Four surfaces had each invented
 * their own dot — the people column bottom-right, the friends list top-left,
 * the DM header bottom-right again, and everywhere else nothing at all — so
 * the same rider read as four different states. This is the vocabulary; the
 * badge that draws it belongs to `Avatar.svelte`, which is what makes it
 * appear wherever a face does.
 *
 * Presence is chrome, so nothing here glows (ADR-0005). `riding` is the one
 * exception and it is not a colour: RidingBars' motion, the same mark the
 * tile and the rail already use.
 */
export type PresenceStatus = 'riding' | 'online' | 'away' | 'offline';

/**
 * Them in a voice channel of one of your crews, by account id (#649: display
 * names are not unique) — as the crews' live read has them (#2444, #2517),
 * which holds only the channels you may enter.
 */
export function occupantOf(
	crews: readonly LiveCrew[],
	riderId: string,
): LiveOccupant | undefined {
	if (!riderId) return undefined;
	for (const crew of crews)
		for (const channel of crew.channels)
			for (const occupant of channel.occupants ?? [])
				if (occupant.id === riderId) return occupant;
	return undefined;
}

/**
 * What the live read knows about them, then what the friends list knows
 * (#1434): a friend with the app open is online (ADR-0012 amendment) whether
 * or not they stand in a channel you can see, and a friend without it is
 * offline — the same two states the friends panel shows. `null` means neither
 * has anything to say — no badge at all, rather than a confident "offline"
 * about a stranger who is simply not in a channel you can see.
 */
export function statusOf(
	crews: readonly LiveCrew[],
	riderId: string,
	friends: readonly Friend[] | null = null,
): PresenceStatus | null {
	const occupant = occupantOf(crews, riderId);
	if (occupant) {
		// Away is what the rider said (#706), and agrees with their tile.
		if (occupant.away) return 'away';
		return occupant.riding ? 'riding' : 'online';
	}
	const friend = friends?.find(
		(f) => f.id === riderId && f.status === 'accepted',
	);
	if (!friend) return null;
	// A friend riding in a channel the viewer cannot see (#1743): the read
	// above only knows channels the viewer may enter, so this used to flatten
	// the third state ADR-0012 names back onto "online" — the same rider read
	// as pedalling to their crew-mates and as idle to their friends.
	if (friend.riding) return 'riding';
	return friend.online ? 'online' : 'offline';
}

/**
 * A rider on the voice channel's own tick, which knows more than the rail
 * can: away is a thing the rider SAID (#706), never inferred from an idle
 * trainer.
 *
 * `riding` comes from the server and means pedalled-inside-the-window
 * (#1016). It used to be read off the current sample's watts here, which put
 * a rider on and off the mark every time they coasted — and meant a different
 * thing again outside the channel, where the same word covered anyone whose
 * trainer was merely switched on.
 */
export function statusOfRider(rider: {
	away?: boolean;
	riding?: boolean;
}): PresenceStatus {
	if (rider.away) return 'away';
	return rider.riding ? 'riding' : 'online';
}
