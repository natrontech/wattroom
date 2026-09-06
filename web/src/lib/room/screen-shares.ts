import type { RoomEvent } from '$lib/protocol';

/**
 * Another rider's screen appearing is a state change the room has to hear
 * (#664): while the jukebox plays the stage rightly stays on the music, so
 * a new share was one more chip in a picker nobody on a bike is watching.
 * LiveKit is the only witness, so the line is this client's own — the
 * room-event shape ADR-0022 already renders, never sent, never persisted.
 */
export interface ScreenShareChange {
	rider: string;
	live: boolean;
}

/**
 * Whose screens came and went between two looks at the stage list. Your own
 * share is left out: the persistent notice above every page already says so
 * (#563), and a line telling you what you just did is noise.
 */
export function screenShareChanges(
	before: ReadonlySet<string>,
	now: ReadonlySet<string>,
	me: string | undefined,
): ScreenShareChange[] {
	const changes: ScreenShareChange[] = [];
	for (const rider of now)
		if (!before.has(rider) && rider !== me) changes.push({ rider, live: true });
	for (const rider of before)
		if (!now.has(rider) && rider !== me) changes.push({ rider, live: false });
	return changes;
}

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
