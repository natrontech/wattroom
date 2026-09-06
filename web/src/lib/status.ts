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
 * The room the presence feed has them in, if any. The rail carries display
 * NAMES and not ids (rail-people.ts), so this is the only question a DM head,
 * a thread row or a chat line can ask about someone.
 *
 * ponytail: names are not unique (#649). That ceiling was already load-bearing
 * in three copies of this lookup; here it is one place, and the one place ids
 * land when the feed learns to carry them.
 */
export function roomOf(
	rooms: readonly RailRoom[],
	name: string,
): RailRoom | undefined {
	if (!name) return undefined;
	return rooms.find((room) => room.riders?.includes(name));
}

/**
 * What the feed knows about them by name. `null` means it has nothing to say
 * — no badge at all, rather than a confident "offline" about someone who is
 * simply not in a room you can see.
 */
export function statusOf(
	rooms: readonly RailRoom[],
	name: string,
): PresenceStatus | null {
	const room = roomOf(rooms, name);
	if (!room) return null;
	return room.riding?.includes(name) ? 'riding' : 'online';
}

/**
 * A rider on the room's own tick, which knows more than the rail can: away is
 * a thing the rider SAID (#706), never inferred from an idle trainer.
 */
export function statusOfRider(rider: {
	away?: boolean;
	watts?: number;
}): PresenceStatus {
	if (rider.away) return 'away';
	return (rider.watts ?? 0) > 0 ? 'riding' : 'online';
}
