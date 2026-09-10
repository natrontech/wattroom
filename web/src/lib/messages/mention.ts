/**
 * Does a line address me? There is no server-side mention yet (#468): a
 * mention is `@` plus your first name, or your whole display name, as people
 * actually type it in a room — "@Jan you in?". Case does not matter and a
 * longer name that merely starts with yours ("@Janine") is someone else's.
 */
export function mentionsMe(text: string, displayName: string | undefined) {
	if (!displayName) return false;
	const names = new Set(
		[displayName, displayName.trim().split(/\s+/)[0]]
			.map((n) => n.trim())
			.filter(Boolean),
	);
	for (const name of names) {
		const pattern = new RegExp(
			`(^|[^\\p{L}\\p{N}_])@${escape(name)}(?![\\p{L}\\p{N}_])`,
			'iu',
		);
		if (pattern.test(text)) return true;
	}
	return false;
}

function escape(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The completion the composer offers (#1766): the draft ends in `@` plus
 * part of a name, and these are the people it could mean. Prefix match,
 * case-insensitive, the exact name already typed offered no further; at
 * most five, in the order the caller ranked them.
 */
export function mentionCompletion(
	draft: string,
	names: readonly string[],
): { at: number; hits: string[] } | null {
	const m = /(^|\s)@([^\s@]*)$/u.exec(draft);
	if (!m) return null;
	const typed = m[2].toLowerCase();
	const hits = names
		.filter(
			(n) => n.toLowerCase().startsWith(typed) && n.toLowerCase() !== typed,
		)
		.slice(0, 5);
	return hits.length ? { at: draft.length - m[2].length - 1, hits } : null;
}

/** The draft with the mention completed, a space after it so typing goes on. */
export function completeMention(draft: string, at: number, name: string) {
	return `${draft.slice(0, at)}@${name} `;
}
