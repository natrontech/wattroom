/**
 * What the door tells a rider before they walk into a room (#1651).
 *
 * ADR-0036 puts the room's weekly board behind the owner's switch and requires
 * it be turned on "visibly — what the room shares is fixed and legible
 * *before* anyone is inside it". Joining is the moment that matters: the board
 * publishes this rider's week — their kJ, their time, their category — to
 * everybody else in the room, and a ride is private by default, so the door
 * has to say so while the rider can still decline by not pressing the button.
 *
 * A door-time choice is deliberately not offered. `ux.md`'s 95% rule: a rider
 * who walks into a room whose door says it keeps a board wants to be on it,
 * and the opt-out already exists on the other side (`memberships.on_board`,
 * ADR-0036's #1100 amendment) for the few who do not. So the last line names
 * that switch rather than duplicating it here.
 *
 * Copy lives here rather than in the markup because it is a privacy
 * disclosure an ADR requires, and a string in a template is guarded by
 * nothing.
 */
export interface DoorDisclosure {
	/** What joining publishes about this rider — absent unless it publishes. */
	board?: string;
	/** True of every room, board or no board (WATTROOM.md's locked rules). */
	privacy: string;
}

export function doorDisclosure(room: {
	boardEnabled?: boolean;
}): DoorDisclosure {
	return {
		board: room.boardEnabled
			? "This room keeps a weekly board: your kJ and time here are ranked beside everyone else's in your category, and it starts fresh every Monday. You can take yourself off it in the room's settings."
			: undefined,
		privacy:
			'Your watts are visible to this room while you ride here, and nowhere else. Voice and camera pass through and are never recorded.',
	};
}
