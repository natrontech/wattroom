/**
 * What the dock's player knows that the rest of the room needs (#216, #286):
 * the iframe lives in JukeboxDock, the transport and the sync readout live
 * wherever the room UI is.
 */
export const playerInfo = $state({
	/** Seconds, for the seek bar. 0 until the player reports one. */
	duration: 0,
	/** A livestream has no seekable timeline at all — the room rides the edge. */
	live: false,
	/** Signed seconds this rider is ahead (+) or behind (−) the room. */
	drift: 0,
	/** The browser refused to start audio without a gesture — needs one tap. */
	blocked: false,
});

/** How far out of step is still "in sync" for a room listening together. */
export const IN_SYNC_SEC = 0.6;
