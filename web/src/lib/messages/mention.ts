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
