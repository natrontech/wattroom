/**
 * What a pasted link becomes (#866, ADR-0031). Two sources, one card:
 *
 *  - YouTube and Spotify answer the browser directly over keyless oEmbed,
 *    with better data than their Open Graph tags and no cost to our server;
 *  - everything else goes to `GET /api/unfurl`, because almost nothing on
 *    the web lets a page that is not its own read it.
 *
 * One fetch per URL per session either way — a busy chat repeats the same
 * link — and a null is cached like a card, so a page with nothing to say is
 * asked once and not once per scroll.
 */
import { api } from '$lib/api';

export type Card = {
	title: string;
	description?: string;
	/** Already pointed at our image proxy — never at the linked site. */
	thumb?: string;
	host: string;
	siteName?: string;
};

const OEMBED: [RegExp, (url: string) => string][] = [
	[
		/^((www|music|m)\.)?youtube\.com$|^youtu\.be$/,
		(url) =>
			`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
	],
	[
		/^open\.spotify\.com$/,
		(url) => `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
	],
];

/** The oEmbed endpoint for a URL, or null when nobody offers one. */
export function oembedFor(url: string): string | null {
	try {
		const host = new URL(url).hostname;
		for (const [pattern, build] of OEMBED)
			if (pattern.test(host)) return build(url);
	} catch {
		/* not a URL */
	}
	return null;
}

/** Whether a URL is one the jukebox could take — the card grows a Queue button. */
export function isYouTube(host: string): boolean {
	return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host);
}

const cache = new Map<string, Promise<Card | null>>();

/** The card for one link, fetched at most once per session. */
export function unfurl(url: string): Promise<Card | null> {
	const cached = cache.get(url);
	if (cached) return cached;
	const pending = load(url).catch(() => null);
	cache.set(url, pending);
	return pending;
}

async function load(url: string): Promise<Card | null> {
	const host = hostOf(url);
	if (host === null) return null;
	const endpoint = oembedFor(url);
	if (endpoint) {
		// Straight to the service, as before: their oEmbed is public, sends
		// CORS, and knows more about their own media than og: tags do.
		const res = await fetch(endpoint);
		if (!res.ok) return null;
		const data = await res.json();
		return data?.title
			? { title: data.title, thumb: proxied(data.thumbnail_url), host }
			: null;
	}
	// 204: the server looked and there was nothing to draw. Not an error.
	const res = await api<{
		title?: string;
		description?: string;
		image?: string;
		siteName?: string;
		host?: string;
	}>(`/api/unfurl?url=${encodeURIComponent(url)}`);
	if (!res.ok || !res.data) return null;
	const { title, description, image, siteName } = res.data;
	if (!title && !description && !image) return null;
	return {
		title: title || res.data.host || host,
		description,
		thumb: proxied(image),
		host: res.data.host || host,
		siteName,
	};
}

/**
 * Point an image at our own origin. A thumbnail loaded straight from the
 * linked site tells that site the address of everyone who scrolled past the
 * message — the exposure `media.ts` already refuses for pasted GIFs, and a
 * chat is full of other people's links.
 */
function proxied(image: string | undefined): string | undefined {
	if (!image || !/^https?:\/\//i.test(image)) return undefined;
	return `/api/unfurl/image?url=${encodeURIComponent(image)}`;
}

function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
}
