/** Chat text split into plain runs and links — the one place a URL becomes an anchor. */
export type Part = { text: string; href?: string; external?: boolean };

// Only http(s), so a `javascript:` paste stays inert text. The last character
// can't be sentence punctuation: "see https://a.b/c." ends at the c.
const URL = /https?:\/\/[^\s<>"]*[^\s<>"'.,:;!?)\]}]/g;

export function linkify(text: string, origin: string): Part[] {
	const parts: Part[] = [];
	let cut = 0;
	for (const match of text.matchAll(URL)) {
		const url = match[0];
		if (match.index > cut) parts.push({ text: text.slice(cut, match.index) });
		// Same-origin links stay in the SPA (room invites); the rest open away.
		const internal =
			origin !== '' && (url === origin || url.startsWith(origin + '/'));
		parts.push({
			text: url,
			href: internal ? url.slice(origin.length) || '/' : url,
			external: !internal,
		});
		cut = match.index + url.length;
	}
	if (cut < text.length) parts.push({ text: text.slice(cut) });
	return parts;
}
