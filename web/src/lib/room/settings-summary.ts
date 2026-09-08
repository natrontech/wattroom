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
