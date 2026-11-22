import { CUES, type CueId } from '#lib/sound/cue-catalogue.ts';

/**
 * What the last cues meant (ux.md: every state change gets a sound and a
 * visual). A chime from across the room — someone stepping out, a voice
 * dropping, the world going flat — is often the only sign of its change, and
 * a rider who heard it had no way to ask what it was. Every cue that sounds
 * is written here, newest first, for the caption to show.
 */
export type Heard = {
	/** Counts up across the page's life: a key, and how a caption knows a new one. */
	seq: number;
	id: CueId;
	/** What happened, in words: the call site's, else the cue's own name. */
	text: string;
	at: number;
};

/** How many the list keeps: enough for the last minute or two of a busy ride. */
export const HEARD_KEPT = 12;

/** Cues a rider's own press makes, heard and seen in the same instant: no caption. */
const SELF: ReadonlySet<CueId> = new Set(['shift-up', 'shift-down', 'shutter']);

export const heard = $state({ list: [] as Heard[] });

let seq = 0;

export function hear(id: CueId, say?: string, at = Date.now()): void {
	if (SELF.has(id)) return;
	const text = say ?? CUES[id].label;
	// A countdown is three ticks and a go: one line, the latest, not four.
	const last = heard.list[0];
	const merged =
		last && last.text === text && at - last.at < 1500
			? heard.list.slice(1)
			: heard.list;
	heard.list = [{ seq: ++seq, id, text, at }, ...merged].slice(0, HEARD_KEPT);
}

/** Tests, and a page that wants a clean slate. */
export function forgetHeard(): void {
	heard.list = [];
}
