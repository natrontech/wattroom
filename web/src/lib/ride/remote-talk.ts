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

/** The holding tab's mic, as much of it as Talk reaches. */
export interface TalkMic {
	readonly status: string;
	readonly micOn: boolean;
	readonly handedOff: boolean;
	readonly away: boolean;
	setPtt(held: boolean): void;
	toggleMic(): Promise<void>;
}

/**
 * Talk as the holding tab runs it (#4163): the rider is heard while it is
 * held, in voice activation as in push-to-talk, and a closed mic opens for
 * the hold and closes after it. A mic that lives on another screen, or a
 * rider who is away, stays as it is. Opens and closes run in order, so a
 * quick release never lands before its open.
 */
export function createTalkOpener(mic: TalkMic) {
	let opened = false;
	let queue = Promise.resolve();
	return (held: boolean) => {
		mic.setPtt(held);
		queue = queue
			.then(async () => {
				if (held && !opened) {
					if (mic.status !== 'live' || mic.micOn) return;
					if (mic.handedOff || mic.away) return;
					await mic.toggleMic();
					opened = mic.micOn;
				} else if (!held && opened) {
					opened = false;
					if (mic.micOn) await mic.toggleMic();
				}
			})
			.catch(() => undefined);
	};
}
