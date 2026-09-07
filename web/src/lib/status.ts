import type { RailRoom } from '$lib/room/mockcompat';

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
 * The room the presence feed has them in, if any — by account id, which is
 * what the feed now carries alongside the names it renders (#649). Display
 * names are not unique, and two riders called Dave used to answer for each
 * other here: a DM header said your friend was riding in a room their
 * namesake was standing in, with a Join button under it.
 */
export function roomOf(
	rooms: readonly RailRoom[],
	riderId: string,
): RailRoom | undefined {
	if (!riderId) return undefined;
	return rooms.find((room) => room.riderIds?.includes(riderId));
}

/**
 * What the feed knows about them. `null` means it has nothing to say — no
 * badge at all, rather than a confident "offline" about someone who is simply
 * not in a room you can see.
 */
export function statusOf(
	rooms: readonly RailRoom[],
	riderId: string,
): PresenceStatus | null {
	const room = roomOf(rooms, riderId);
	if (!room) return null;
	return room.ridingIds?.includes(riderId) ? 'riding' : 'online';
}

/**
 * A rider on the room's own tick, which knows more than the rail can: away is
 * a thing the rider SAID (#706), never inferred from an idle trainer.
 *
 * `riding` comes from the server and means pedalled-inside-the-window
 * (#1016). It used to be read off the current sample's watts here, which put
 * a rider on and off the mark every time they coasted — and meant a different
 * thing again outside the room, where the same word covered anyone whose
 * trainer was merely switched on.
 */
export function statusOfRider(rider: {
	away?: boolean;
	riding?: boolean;
}): PresenceStatus {
	if (rider.away) return 'away';
	return rider.riding ? 'riding' : 'online';
}
