/**
 * A refresh puts you back in voice — and nothing else does (#480).
 *
 * The page dies with the LiveKit room, so a reload starts at `status: 'off'`
 * and the rider goes silent without noticing. The fix is a per-device note
 * saying "this tab was in voice in <slug>, as of <ts>, mic open/shut", kept
 * warm while the call is live and torn up the moment the rider hangs up.
 *
 * The decision is deliberately a pure function: joining LiveKit cannot be
 * exercised without LiveKit, but *whether* to join is the part that has to be
 * right, and it is the part a test can pin down.
 */

/** One tab's note. Keyed by tab id — a device runs several. */
export interface VoiceNote {
	slug: string;
	/** Last heartbeat, `Date.now()` — not the join, so a long ride still counts. */
	at: number;
	/** Was the mic open? A rider who was muted comes back muted. */
	mic: boolean;
}

/** Every tab's note on this device, keyed by tab id. */
export type VoiceNotes = Record<string, VoiceNote>;

/**
 * Older than this and it is not a refresh, it is coming back after lunch —
 * SPEC.md "Room audio defaults", recorded there by the ADR-0010 amendment.
 */
export const REJOIN_WINDOW_MS = 60_000;

/** How often a live tab restamps its note. Three beats fit the window. */
export const REJOIN_HEARTBEAT_MS = 20_000;

/** What the rejoin restores. The camera is never in here — see below. */
export interface Rejoin {
	/** Open the mic on arrival, or come back listening only. */
	mic: boolean;
}

export interface RejoinInput {
	/** Every tab's note as read from storage — missing or junk is fine. */
	notes: VoiceNotes | null | undefined;
	/** This tab's id, stable across a reload and unique per tab. */
	tab: string;
	/** The room being opened. */
	slug: string;
	/** `account.me.avEnabled` — no AV, no rejoin. */
	avEnabled: boolean;
	now: number;
}

function fresh(note: VoiceNote, now: number): boolean {
	const age = now - note.at;
	// A stamp from the future means the clock moved under us; that is not
	// evidence of a refresh, so it does not buy one.
	return age >= 0 && age <= REJOIN_WINDOW_MS;
}

function isNote(value: unknown): value is VoiceNote {
	if (typeof value !== 'object' || value === null) return false;
	const note = value as Partial<VoiceNote>;
	return (
		typeof note.slug === 'string' &&
		typeof note.at === 'number' &&
		Number.isFinite(note.at) &&
		typeof note.mic === 'boolean'
	);
}

/**
 * Should this tab walk straight back into voice, and with the mic open?
 *
 * `null` means stay off — the rider presses Join voice, exactly as today.
 * Every unknown answers `null`: a cleared, corrupt or older-version store
 * just does not rejoin, which is the pre-#480 behaviour and harmless.
 *
 * The mic held by another tab is the one veto that is not about this tab at
 * all. Joining is what moves the mic between tabs (#293: newest wins), so an
 * automatic rejoin would silently steal the mic from the tab the rider is
 * actually talking into. It yields instead, whatever room that tab is in —
 * there is one microphone on the machine, and it is in use.
 */
export function shouldRejoinVoice(input: RejoinInput): Rejoin | null {
	const { notes, tab, slug, avEnabled, now } = input;
	if (!avEnabled) return null;
	if (typeof notes !== 'object' || notes === null) return null;

	const mine = notes[tab];
	if (!isNote(mine)) return null;
	if (mine.slug !== slug) return null;
	if (!fresh(mine, now)) return null;

	for (const [id, note] of Object.entries(notes)) {
		if (id === tab || !isNote(note)) continue;
		if (note.mic && fresh(note, now)) return null;
	}
	return { mic: mine.mic };
}

// ── The edges: storage in, storage out ──────────────────────────────────────
// Same shape and versioning as `wattroom.voice.v1` / `wattroom.devices.v1`:
// one JSON object under one versioned key, and every failure is silent
// because none of this is worth breaking a room over.

const NOTES_KEY = 'wattroom.voice.rejoin.v1';
/** Per TAB, not per device: sessionStorage survives F5 and dies with the tab. */
const TAB_KEY = 'wattroom.tab.v1';

/** This tab's identity across reloads. Reload-stable is the whole point. */
export function tabId(): string {
	try {
		const seen = sessionStorage.getItem(TAB_KEY);
		if (seen) return seen;
		const fresh = crypto.randomUUID();
		sessionStorage.setItem(TAB_KEY, fresh);
		return fresh;
	} catch {
		// Storage blocked: a per-load id never matches a note, so no rejoin.
		return 'no-storage';
	}
}

export function readNotes(): VoiceNotes | null {
	try {
		const raw = JSON.parse(localStorage.getItem(NOTES_KEY) ?? 'null');
		return typeof raw === 'object' && raw !== null ? (raw as VoiceNotes) : null;
	} catch {
		return null;
	}
}

/**
 * Restamp this tab's note, dropping every note nothing can act on any more —
 * a crashed tab's leftovers stop vetoing the mic once they go stale.
 */
export function writeNote(tab: string, note: VoiceNote): void {
	try {
		const notes = readNotes() ?? {};
		const kept: VoiceNotes = {};
		for (const [id, other] of Object.entries(notes))
			if (id !== tab && isNote(other) && fresh(other, note.at))
				kept[id] = other;
		kept[tab] = note;
		localStorage.setItem(NOTES_KEY, JSON.stringify(kept));
	} catch {
		// per-device convenience only
	}
}

/** Hanging up is the rider saying so: leaving then reloading stays out. */
export function clearNote(tab: string): void {
	try {
		const notes = readNotes();
		if (!notes) return;
		delete notes[tab];
		localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
	} catch {
		// per-device convenience only
	}
}
