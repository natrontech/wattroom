/**
 * The rider's own clips (#877). A board is one rider's: this is only ever
 * YOUR library, and the audio of everyone else's clips is fetched by id as
 * their fires arrive (`$lib/sound/board.svelte`).
 */
import { prefetch } from '$lib/sound/board.svelte';

export interface Clip {
	id: string;
	name: string;
	/** 1–9, or absent for a clip in the library but on no pad. */
	pad?: number;
	millis: number;
	bytes: number;
	uploaded: number;
}

/** How many pads a board has — the server's check constraint says the same. */
export const PADS = 9;

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
	/** The clip on one pad, or undefined for an empty slot. */
	onPad(pad: number): Clip | undefined {
		return clips.find((c) => c.pad === pad);
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
	return undefined;
}

/** The lowest pad with nothing on it, or undefined when the board is full. */
export function firstFreePad(): number | undefined {
	for (let pad = 1; pad <= PADS; pad++) {
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

export async function remove(clipId: string): Promise<void> {
	const res = await fetch(`/api/board/clips/${clipId}`, { method: 'DELETE' });
	if (res.ok) await board.refresh();
}
