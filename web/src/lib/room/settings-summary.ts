/**
 * What a member's read-only view of a room's settings says (#1099).
 *
 * Pure, and separate from the page, because the numbers here are the part
 * that can be quietly wrong: a roster carries banned riders for an owner and
 * not for anyone else, and counting them would tell a member the room is
 * bigger than it is.
 */

export interface RoomMember {
	id: string;
	displayName: string;
	role: string;
	joinedAt?: string;
}

/** Who owns the room, for "<name> owns it". */
export function ownerName(members: RoomMember[]): string {
	return members.find((m) => m.role === 'owner')?.displayName ?? 'somebody';
}

/**
 * How many people ride here. Banned riders sit on the roster the OWNER
 * receives (rooms.go keeps the ban list off everyone else's), so counting the
 * array would give the owner and a member two different totals for the same
 * room — and only the owner's would be wrong.
 */
export function memberCount(members: RoomMember[]): number {
	return members.filter((m) => m.role !== 'banned').length;
}

/**
 * When the viewer joined, or undefined if they are not on the roster — the
 * account store loads separately from the room, so "who am I" is routinely
 * unknown for the first render. Saying nothing is the whole handling: the
 * line simply drops that clause.
 */
export function joinedOn(
	members: RoomMember[],
	viewerId: string | undefined,
): string | undefined {
	return viewerId
		? members.find((m) => m.id === viewerId)?.joinedAt
		: undefined;
}

/**
 * The sound pack's rider-facing name. An unknown id shows itself rather than
 * an empty cell — a room saved by a future version should read oddly, not
 * blankly.
 */
export function packLabel(
	packs: { id: string; label: string }[],
	soundPack: string | undefined,
): string {
	const id = soundPack ?? 'base';
	return packs.find((p) => p.id === id)?.label ?? id;
}

/**
 * What deleting the room takes, said before the button (#1935).
 *
 * The crew clause is the part that can be quietly wrong. A crew with another
 * room, or anyone besides its owner, survives the deletion; one with neither
 * goes with the room, and the confirm used to say nothing either way — so an
 * owner deleting their last room lost the crew's name, its logo and its invite
 * link without having been told. The server answers the question
 * (`crew.goesWithRoom`), because it is the same predicate the delete itself
 * applies; guessing it from the room list is how the two come to disagree.
 */
export function deleteRoomBody(
	crew: { name: string; goesWithRoom?: boolean } | undefined,
): string {
	const room =
		"Removes the room for everyone in it — its chat, its planned sessions and their RSVPs, its session recaps, its medal history and its streak. Rides already ridden stay in each rider's own history. This can't be undone.";
	if (!crew?.goesWithRoom) return room;
	return `${room} It is the only room in ${crew.name} and nobody else is in the crew, so the crew goes with it — its name, its logo and its invite link. Your next room starts a fresh crew.`;
}
