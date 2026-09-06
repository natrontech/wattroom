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
