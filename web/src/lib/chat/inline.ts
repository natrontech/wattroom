import { EMOJI_NAME } from '$lib/emoji/crew-emoji.svelte';
import { sameOriginPath } from '$lib/same-origin';

/** One run of chat text: plain, a link, or marked up. Marks don't nest. */
export type Part = {
	text: string;
	href?: string;
	external?: boolean;
	code?: boolean;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	/** A crew's own emoji by name (#2643) — drawn if the crew knows it. */
	emoji?: string;
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
		new RegExp(`:(?<emoji>${EMOJI_NAME}):`),
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
			// Same-origin links stay in the SPA (crew invites); the rest open away.
			const path = ownPath(g.url, origin);
			parts.push({ text: g.url, href: path ?? g.url, external: path === null });
		} else if (g.code !== undefined) parts.push({ text: g.code, code: true });
		else if (g.emoji !== undefined)
			parts.push({ text: match[0], emoji: g.emoji });
		else if (g.bold !== undefined) parts.push({ text: g.bold, bold: true });
		else if (g.italic !== undefined)
			parts.push({ text: g.italic, italic: true });
		else if (g.strike !== undefined)
			parts.push({ text: g.strike, strike: true });
	}
	if (cut < text.length) parts.push({ text: text.slice(cut) });
	return parts;
}

/**
 * The in-app path a URL on `origin` names, or null. The origin alone is not
 * enough (#2817): "<origin>//evil.example" keeps the origin, and its path
 * is protocol-relative once the origin is sliced off.
 */
function ownPath(url: string, origin: string): string | null {
	if (origin === '') return null;
	try {
		const u = new URL(url);
		const path = u.pathname + u.search + u.hash;
		return u.origin === origin && sameOriginPath(path, origin) ? path : null;
	} catch {
		return null;
	}
}
