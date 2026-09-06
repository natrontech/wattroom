import type { RoomEvent } from '$lib/protocol';

import { comingsAndGoings, type Coming } from '$lib/room/comings-and-goings';

/**
 * Another rider's screen appearing is a state change the room has to hear
 * (#664): while the jukebox plays the stage rightly stays on the music, so
 * a new share was one more chip in a picker nobody on a bike is watching.
 * LiveKit is the only witness, so the line is this client's own — the
 * room-event shape ADR-0022 already renders, never sent, never persisted.
 *
 * The diff itself is `comingsAndGoings` (#854): the voice channel asks the
 * same question of a different set.
 */
export type ScreenShareChange = Coming;

export const screenShareChanges = comingsAndGoings;

/**
 * The timeline line for one change. The id carries the moment, so a rider
 * who shares twice leaves two lines — these are ephemeral anyway, and a
 * burst-style replace would walk the first one down the log.
 */
export function screenShareEvent(
	change: ScreenShareChange,
	name: string | undefined,
	at: number,
): RoomEvent {
	return {
		id: `screen:${change.rider}:${at}:${change.live ? 'on' : 'off'}`,
		kind: 'screen',
		verb: change.live ? 'shared' : 'unshared',
		actor: name || 'Someone',
		count: 1,
		at,
	};
}
