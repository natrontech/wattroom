/**
 * The rider's own clips (#877). A board is one rider's: this is only ever
 * YOUR library, and the audio of everyone else's clips is fetched by id as
 * their fires arrive (`$lib/sound/board.svelte`).
 */
import { prefetch } from '$lib/sound/board.svelte';

export interface Edit {
	startMs: number;
	/** 0 means "to the end of the source" — a clip nobody has trimmed. */
	endMs: number;
	gainDb: number;
	fadeInMs: number;
	fadeOutMs: number;
}

export interface Clip extends Edit {
	id: string;
	name: string;
	/** A position on the board, or absent for a clip only in the library. */
	pad?: number;
	/** The key that fires it, or absent for a clip that is only tapped. */
	key?: string;
	/** The SOURCE's length; the edit above says what actually plays. */
	millis: number;
	bytes: number;
	uploaded: number;
}

/** How long a clip actually sounds for, once its trim is applied. */
export function keptMillis(clip: Clip): number {
	return (clip.endMs || clip.millis) - clip.startMs;
}

/**
 * The fewest pads a board ever shows. Not a ceiling: the grid grows as clips
 * are added (`padCount`), and the rider's storage quota is the real limit.
 * Nine keeps an empty board looking like a board rather than a single slot.
 */
export const MIN_PADS = 9;

/** The server's sanity bound on a pad number — not a product ceiling. */
export const MAX_PAD = 999;

let clips = $state<Clip[]>([]);
let used = $state(0);
let limit = $state(0);
let loaded = $state(false);
let loading: Promise<void> | undefined;

async function fetchAll(): Promise<void> {
	const res = await fetch('/api/board/clips');
	if (!res.ok) return;
	const body = (await res.json()) as {
		clips: Clip[];
		used: number;
		limit: number;
	};
	clips = body.clips;
	used = body.used;
	limit = body.limit;
	loaded = true;
	// Warm your own pads: the first press of a ride should not be the one
	// that pays for the download.
	prefetch(clips.filter((c) => c.pad).map((c) => c.id));
}

export const board = {
	get clips() {
		return clips;
	},
	get used() {
		return used;
	},
	get limit() {
		return limit;
	},
	get loaded() {
		return loaded;
	},
	/**
	 * How many pads to draw: every one in use, plus a spare to fill, and never
	 * fewer than MIN_PADS. A board that grew never shrinks under the rider
	 * mid-session either — the highest pad in use holds the floor.
	 */
	get padCount(): number {
		const highest = clips.reduce((max, c) => Math.max(max, c.pad ?? 0), 0);
		return Math.max(MIN_PADS, highest + 1);
	},
	/** The clip on one pad, or undefined for an empty slot. */
	onPad(pad: number): Clip | undefined {
		return clips.find((c) => c.pad === pad);
	},
	/** The clip a keystroke fires, if any rider bound one to it. */
	onKey(key: string): Clip | undefined {
		const wanted = key.toLowerCase();
		return clips.find((c) => c.key === wanted);
	},
	/** Loads once per session; every caller can ask. */
	load(): Promise<void> {
		loading ??= fetchAll().finally(() => {
			loading = undefined;
		});
		return loading;
	},
	/** After an upload, a delete or a pad change, the server is the truth. */
	async refresh(): Promise<void> {
		await fetchAll();
	},
};

/** Turn a filename into a pad label: no extension, upper case, pad-sized. */
export function nameFromFile(filename: string): string {
	const stem = filename.replace(/\.[^.]+$/, '').trim();
	return (stem || 'CLIP').toUpperCase().slice(0, 32);
}

export interface Refusal {
	message: string;
}

/**
 * Upload one file. The server is the trust boundary for size, length and
 * quota (ADR-0033) — this reports what it says rather than guessing first,
 * so the rule has one home.
 */
export async function upload(file: File): Promise<Refusal | undefined> {
	const res = await fetch(
		`/api/board/clips?name=${encodeURIComponent(nameFromFile(file.name))}`,
		{ method: 'POST', body: file },
	);
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		return { message: body.message ?? 'The clip could not be saved.' };
	}
	const { id } = (await res.json()) as { id: string };
	await board.refresh();
	// A clip nobody can press is not much of a clip: the first free pad takes
	// it. Beyond nine, the upload lands in the library and the rider chooses.
	const free = firstFreePad();
	if (free) await assign(id, free);
	// And a digit while one is going spare, so a new clip is reachable from
	// the keyboard the way the first nine always were. Past that the rider
	// picks a key — there are only ten digits, and a board can be bigger.
	const digit = firstFreeDigit();
	if (digit) await bindKey(id, digit);
	return undefined;
}

/** The lowest digit nothing is bound to, or undefined once all ten are taken. */
export function firstFreeDigit(): string | undefined {
	for (const digit of '123456789') {
		if (!board.onKey(digit)) return digit;
	}
	return undefined;
}

/** The lowest pad with nothing on it, or undefined when the board is full. */
export function firstFreePad(): number | undefined {
	for (let pad = 1; pad <= MAX_PAD; pad++) {
		if (!board.onPad(pad)) return pad;
	}
	return undefined;
}

/** Put a clip on a pad, or take it off with null. */
export async function assign(
	clipId: string,
	pad: number | null,
): Promise<void> {
	const res = await fetch(`/api/board/clips/${clipId}/pad`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ pad }),
	});
	if (res.ok) await board.refresh();
}

/**
 * Put a clip on a pad, SWAPPING with whatever was already there (#981).
 *
 * `assign` alone bumps the occupant to the library — the unique index has to
 * be freed before the write lands — which meant a rider tidying their board
 * silently knocked a clip off it. The occupant takes the pad this clip just
 * left instead, so nothing leaves the board that the rider did not take off.
 */
export async function movePad(
	clipId: string,
	pad: number | null,
): Promise<void> {
	const from = board.clips.find((c) => c.id === clipId)?.pad ?? null;
	const displaced = pad === null ? undefined : board.onPad(pad);
	await assign(clipId, pad);
	if (displaced && displaced.id !== clipId && from !== null) {
		await assign(displaced.id, from);
	}
}

/** Rename a clip. The name was the uploaded file's stem and set once (#981). */
export async function rename(
	clipId: string,
	name: string,
): Promise<Refusal | undefined> {
	const res = await fetch(`/api/board/clips/${clipId}/name`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		return { message: body.message ?? 'The name could not be changed.' };
	}
	await board.refresh();
	return undefined;
}

// ponytail: delete stays a confirm rather than errors.md's preferred undo.
// The row and the audio both go on DELETE, and the browser does not keep the
// file it uploaded — so "undo" would mean asking the rider for the MP3 again,
// which is not an undo. #981 named this the case to say out loud rather than
// silently drop. An undo toast becomes possible the day a delete is a soft
// one, and this is the only place that would change.
export async function remove(clipId: string): Promise<void> {
	const res = await fetch(`/api/board/clips/${clipId}`, { method: 'DELETE' });
	if (res.ok) await board.refresh();
}

/** Save a clip's trim, gain and fades. The audio is never re-encoded. */
export async function saveEdit(
	clipId: string,
	edit: Edit,
): Promise<Refusal | undefined> {
	const res = await fetch(`/api/board/clips/${clipId}/edit`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(edit),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		return { message: body.message ?? 'The edit could not be saved.' };
	}
	await board.refresh();
	return undefined;
}

/**
 * Bind a key to a clip, or clear it with null. The server moves the key off
 * whatever held it, so the caller never has to unbind first.
 */
export async function bindKey(
	clipId: string,
	key: string | null,
): Promise<Refusal | undefined> {
	const res = await fetch(`/api/board/clips/${clipId}/key`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ key }),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		return { message: body.message ?? 'The key could not be set.' };
	}
	await board.refresh();
	return undefined;
}
