/**
 * The Unicode emoji a reaction or a message can carry (#2643), from
 * emojibase's English data — loaded the first time a picker opens, so the
 * ~70 KB it weighs over the wire is paid by the rider who reacts, not by
 * every page. No skin-tone variants: the server's shape check (IsEmoji)
 * bounds a reaction at 8 runes, which the base set fits exactly.
 * ponytail: the newest emoji draw as tofu on an OS older than their Unicode
 * version; filter by emojibase's `version` (data.json) if riders report it.
 */

export type Emoji = { unicode: string; label: string; tags: string[] };

export type EmojiGroup = { key: string; label: string; emoji: Emoji[] };

/** emojibase's compact shape, as much of it as the picker reads. */
type Compact = {
	unicode: string;
	label: string;
	group?: number;
	order?: number;
	tags?: string[];
};

// emojibase group numbers, in picker order; 2 is the bare skin-tone
// swatches and ungrouped entries are regional indicator letters — neither is
// an emoji a rider picks. The tab is drawn from `key` (#458: chrome is icons).
const GROUPS: [number, string, string][] = [
	[0, 'smile', 'Smileys'],
	[1, 'hand', 'People'],
	[3, 'paw-print', 'Animals & nature'],
	[4, 'pizza', 'Food & drink'],
	[5, 'plane', 'Travel & places'],
	[6, 'volleyball', 'Activities'],
	[7, 'lightbulb', 'Objects'],
	[8, 'hash', 'Symbols'],
	[9, 'flag', 'Flags'],
];

/** Groups the data in picker order, each group by emojibase's own order. */
export function groupEmoji(data: Compact[]): EmojiGroup[] {
	return GROUPS.map(([n, key, label]) => ({
		key,
		label,
		emoji: data
			.filter((e) => e.group === n)
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
			.map((e) => ({ unicode: e.unicode, label: e.label, tags: e.tags ?? [] })),
	}));
}

let loading: Promise<EmojiGroup[]> | null = null;

/** Every group, loaded once; a failed load is retried on the next open. */
export function loadEmoji(): Promise<EmojiGroup[]> {
	loading ??= import('emojibase-data/en/compact.json')
		.then((m) => groupEmoji(m.default as unknown as Compact[]))
		.catch((err) => {
			loading = null;
			throw err;
		});
	return loading;
}

/**
 * Emoji whose label or a tag starts with every word of the query — "thumb
 * up" finds 👍, "lol" finds 😂 by its tag. Labels first, then tags.
 */
export function searchEmoji(
	groups: EmojiGroup[],
	query: string,
	limit = 72,
): Emoji[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const byLabel: Emoji[] = [];
	const byTag: Emoji[] = [];
	for (const e of groups.flatMap((g) => g.emoji)) {
		const labelWords = e.label.toLowerCase().split(/[\s:,-]+/);
		const starts = (pool: string[]) =>
			words.every((w) => pool.some((p) => p.startsWith(w)));
		if (starts(labelWords)) byLabel.push(e);
		else if (starts([...labelWords, ...e.tags])) byTag.push(e);
	}
	return [...byLabel, ...byTag].slice(0, limit);
}
