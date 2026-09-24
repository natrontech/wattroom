/**
 * A crew's own emoji (#2643): what its members uploaded, drawn wherever a
 * reaction or a `:name:` in a message names one. Crew-private — the image
 * endpoint is behind the crew's gate — so a surface draws them only when it
 * sits inside a crew, which `provideCrewEmoji` says through context. A DM
 * has no crew and draws `:name:` as the text it is.
 */
import { getContext, setContext } from 'svelte';
import { api } from '$lib/api';
import { MaxEmojiNameChars, MinEmojiNameChars } from '$lib/protocol';

export type CrewEmoji = {
	id: string;
	name: string;
	/** Who added it — they may take it down, as may the crew's owner and admins. */
	userId: string;
	createdAt: string;
};

const lists = $state<Record<string, CrewEmoji[]>>({});
// Plain, not state: read during render, written after a fetch.
const fetchedAt: Record<string, number> = {};
const inflight: Record<string, Promise<string | null> | undefined> = {};

// A name nobody here knows yet is most likely one a member just added: ask
// again, but at most this often, so a typo'd `:nmae:` costs one read.
const STALE_MS = 30_000;

/** A crew emoji's name, the server's IsCustomEmojiName. */
export const EMOJI_NAME = `[a-z0-9_]{${MinEmojiNameChars},${MaxEmojiNameChars}}`;

const KEY = new RegExp(`^:(${EMOJI_NAME}):$`);

/** A reaction key's emoji name, `:party_parrot:` → `party_parrot`. */
export function customName(key: string): string | null {
	return KEY.exec(key)?.[1] ?? null;
}

/** The list, read afresh; resolves to the refusal, or null. */
export function loadCrewEmoji(crewId: string): Promise<string | null> {
	inflight[crewId] ??= api<{ emoji: CrewEmoji[] }>(
		`/api/crews/${crewId}/emoji`,
	).then((res) => {
		inflight[crewId] = undefined;
		fetchedAt[crewId] = Date.now();
		if (!res.ok) return res.error.message;
		lists[crewId] = res.data.emoji;
		return null;
	});
	return inflight[crewId];
}

export const crewEmoji = {
	list: (crewId: string): CrewEmoji[] => lists[crewId] ?? [],
	/** The image for `name` in this crew, or null while nobody knows it. */
	url(crewId: string, name: string): string | null {
		const hit = lists[crewId]?.find((e) => e.name === name);
		if (hit) return `/api/crews/${crewId}/emoji/${hit.id}`;
		if (Date.now() - (fetchedAt[crewId] ?? 0) > STALE_MS)
			void loadCrewEmoji(crewId);
		return null;
	},
};

const CREW = Symbol('crew-emoji');

/** Everything below draws this crew's emoji. */
export function provideCrewEmoji(crewId: () => string | undefined): void {
	setContext(CREW, crewId);
	$effect(() => {
		const id = crewId();
		if (id) void loadCrewEmoji(id);
	});
}

/**
 * Which crew's emoji this surface draws — undefined outside a crew. Call it
 * while the component initialises; read the getter it returns in markup.
 */
export function emojiCrew(): () => string | undefined {
	return (
		getContext<(() => string | undefined) | undefined>(CREW) ??
		(() => undefined)
	);
}
