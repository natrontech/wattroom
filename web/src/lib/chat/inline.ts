/** One run of chat text: plain, a link, or marked up. Marks don't nest. */
export type Part = {
	text: string;
	href?: string;
	external?: boolean;
	code?: boolean;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
};

// One pass, first alternative wins: code is literal, and a URL is claimed
// before `_` inside it can read as emphasis. Only http(s) links, so a
// `javascript:` paste stays inert text. A URL can't end on sentence
// punctuation: "see https://a.b/c." ends at the c. Marked runs can't start
// or end on a space, so arithmetic ("5 * 3 * 2") stays arithmetic.
const TOKEN = new RegExp(
	[
		/`(?<code>[^`\n]+)`/,
		/(?<url>https?:\/\/[^\s<>"]*[^\s<>"'.,:;!?)\]}])/,
		/\*\*(?<bold>\S(?:[^*\n]*\S)?)\*\*/,
		/(?<![\w*_])(?<fence>[*_])(?<italic>\S(?:[^*_\n]*\S)?)\k<fence>(?![\w*_])/,
		/~~(?<strike>\S(?:[^~\n]*\S)?)~~/,
	]
		.map((part) => part.source)
		.join('|'),
	'g',
);

export function parseInline(text: string, origin: string): Part[] {
	const parts: Part[] = [];
	let cut = 0;
	for (const match of text.matchAll(TOKEN)) {
		const g = match.groups ?? {};
		if (match.index > cut) parts.push({ text: text.slice(cut, match.index) });
		cut = match.index + match[0].length;
		if (g.url !== undefined) {
			// Same-origin links stay in the SPA (room invites); the rest open away.
			const internal =
				origin !== '' && (g.url === origin || g.url.startsWith(origin + '/'));
			parts.push({
				text: g.url,
				href: internal ? g.url.slice(origin.length) || '/' : g.url,
				external: !internal,
			});
		} else if (g.code !== undefined) parts.push({ text: g.code, code: true });
		else if (g.bold !== undefined) parts.push({ text: g.bold, bold: true });
		else if (g.italic !== undefined)
			parts.push({ text: g.italic, italic: true });
		else if (g.strike !== undefined)
			parts.push({ text: g.strike, strike: true });
	}
	if (cut < text.length) parts.push({ text: text.slice(cut) });
	return parts;
}
