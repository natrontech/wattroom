/** How often the phone says Talk is still held; the holder lets go after 1 s. */
export const TALK_BEAT_MS = 400;

/**
 * Talk on the phone remote is held, never toggled (#3217): talk-down, a beat
 * while the finger stays, talk-up. A phone that dies mid-hold stops beating
 * and the holding tab releases (TALK_KEEPALIVE_MS in keys.ts).
 */
export function createTalkHold(send: (action: string) => void) {
	let beat: ReturnType<typeof setInterval> | undefined;
	const up = () => {
		if (beat === undefined) return;
		clearInterval(beat);
		beat = undefined;
		send('talk-up');
	};
	return {
		down() {
			if (beat !== undefined) return;
			send('talk-down');
			beat = setInterval(() => send('talk-keepalive'), TALK_BEAT_MS);
		},
		up,
	};
}
