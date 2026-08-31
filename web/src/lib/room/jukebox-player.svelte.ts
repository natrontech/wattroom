/**
 * What the dock's player knows that the controls need (#216): the video's
 * duration (for the seek bar) — the iframe lives in JukeboxDock, the
 * transport lives wherever the room UI is.
 */
export const playerInfo = $state({ duration: 0 });
