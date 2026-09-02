/** Tiles the strip has room for: two by two at the sidebar's width. */
export const STRIP_MAX = 4;

/**
 * Who spoke last, first — Discord's voice panel order (#446). `lastSpoke`
 * holds the moment each id was last heard; anyone never heard follows, by
 * name, so the strip holds still while nobody talks and reshuffles only when
 * someone does.
 */
export function orderBySpoke<T extends { id: string; name: string }>(
	riders: readonly T[],
	lastSpoke: ReadonlyMap<string, number>,
): T[] {
	return [...riders].sort(
		(a, b) =>
			(lastSpoke.get(b.id) ?? 0) - (lastSpoke.get(a.id) ?? 0) ||
			a.name.localeCompare(b.name),
	);
}
