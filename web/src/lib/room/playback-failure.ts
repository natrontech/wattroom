/**
 * Whose failure is it (#1896)? Every client reports the end of a play and
 * the hub takes the first, so a rider reporting "ended" on a failure that
 * was theirs alone — a dropped range request, a codec their browser lacks,
 * a player hiccup — skipped the track for the whole room, with a toast only
 * they saw. Only a failure nobody can get past ends the room's play; the
 * rest sits this rider out until the room moves on.
 */

/** YouTube player error codes that mean no rider can play the video. */
export function youtubeFailureIsGlobal(code: number): boolean {
	// 2: malformed id. 100: removed or private. 101/150: embedding refused.
	// 5 (an HTML5 player error) and anything unlisted is this browser's.
	return code === 2 || code === 100 || code === 101 || code === 150;
}

/** An uploaded track's answer to a HEAD: gone for everyone, or not. */
export function trackFailureIsGlobal(status: number): boolean {
	return status === 404 || status === 410;
}
