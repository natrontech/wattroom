/**
 * A click on a voice channel in the sidebar is the tap that joins its voice
 * (#2702, ADR-0010's click amendment). Every other way onto the page — a
 * link, a reload, a toast, the session line, the end of a session — still
 * connects nothing, so the click leaves a one-shot note here and the channel
 * shell takes it on mount. It lives in memory, never in storage: a reload
 * must find nothing (the 60 s rejoin in rejoin.ts is the refresh's path).
 */

/** What the channel the rider is walking into should do on arrival. */
export interface VoiceIntent {
	/** The place's address key (`PlaceAddress.key`). */
	key: string;
	/** The mic as the rider had it in the channel they left; undefined = join's own default. */
	mic?: boolean;
	/** A camera already live in the channel they left comes along (#2702). */
	cam: boolean;
	at: number;
}

/**
 * Longer than any navigation takes, shorter than a rider walking away and
 * coming back by a link: a click whose page never mounted must not join a
 * later arrival.
 */
export const INTENT_TTL_MS = 10_000;

/** The call the rider is in now, as far as carrying it over needs. */
export interface CallNow {
	status: string;
	micOn: boolean;
	camOn: boolean;
}

let pending: VoiceIntent | null = null;

/**
 * The sidebar row's click. A rider already in voice somewhere arrives with
 * the mic and camera as they were; one who was not joins the way Join voice
 * would. Voice being live is the test: a camera cannot be on without it.
 */
export function askVoice(key: string, call: CallNow | undefined, now: number) {
	const inVoice = call?.status === 'live';
	pending = {
		key,
		mic: inVoice ? call.micOn : undefined,
		cam: inVoice && call.camOn,
		at: now,
	};
}

/** The shell's mount: the note for this place, once, or nothing. */
export function takeVoice(key: string, now: number): VoiceIntent | null {
	const note = pending;
	pending = null;
	if (!note || note.key !== key) return null;
	const age = now - note.at;
	return age >= 0 && age <= INTENT_TTL_MS ? note : null;
}
