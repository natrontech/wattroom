import type { RoomEvent } from '$lib/protocol';

/**
 * A DM that arrived while the rider was on the bike (#1743), written into the
 * room's timeline instead of thrown across the riding screen as a toast.
 *
 * This client's own line, never the server's — a DM is between two people and
 * the room knows nothing of it. Room events are ephemeral and never persisted
 * (ADR-0022), so it stays on this one screen and reaches nobody else in the
 * room, which is the only reason a private message may be written there at all.
 *
 * The sender, never the words. The toast this replaces went away by itself; a
 * riding screen is a screen a rider sets up to be readable from across a room,
 * and sometimes a television.
 */
export function dmArrivalEvent(from: string, at: number): RoomEvent {
	return {
		// The moment is in the id: two messages from the same person are two
		// lines, the way two chat lines are.
		id: `dm:${from}:${at}`,
		kind: 'dm',
		verb: 'messaged',
		actor: from,
		count: 1,
		at,
	};
}
