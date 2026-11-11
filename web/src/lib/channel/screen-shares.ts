import {
	comingsAndGoings,
	type Coming,
} from '#lib/channel/comings-and-goings.ts';

/**
 * Another rider's screen appearing is a state change the call has to hear
 * (#664): while the jukebox plays the stage rightly stays on the music, so
 * a new share was one more chip in a picker nobody on a bike is watching.
 * LiveKit is the only witness, so the join cue is this client's own.
 *
 * The diff itself is `comingsAndGoings` (#854): the voice channel asks the
 * same question of a different set.
 */
export type ScreenShareChange = Coming;

export const screenShareChanges = comingsAndGoings;
