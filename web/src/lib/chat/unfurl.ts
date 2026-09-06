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

/**
 * Thrown for an answer that means "ask again" rather than "there is nothing
 * here" — the server's ration, or a request that never arrived. The
 * difference matters: a remembered null is remembered for the whole session,
 * so a rider who opened a busy channel and spent their ration would be left
 * looking at bare URLs until they reloaded the page.
 */
const RETRY = Symbol('unfurl: ask again');

/**
 * How long to wait out a refusal before asking again. Opening a channel with
 * a screenful of unseen links spends the server's bucket, which then refills
 * over the next second or two — so the card is not missing, it is early. The
 * waits cover that, and the caller is holding the same promise throughout, so
 * a card that arrives on the second try still lands on the message.
 */
const BACKOFF_MS = [1200, 2500, 5000];

/** The card for one link, fetched at most once per session. */
export function unfurl(url: string): Promise<Card | null> {
	const cached = cache.get(url);
	if (cached) return cached;
	const pending = attempt(url, 0);
	cache.set(url, pending);
	return pending;
}

async function attempt(url: string, tries: number): Promise<Card | null> {
	try {
		return await load(url);
	} catch (reason) {
		if (reason !== RETRY) return null; // a real "nothing here" — remember it
		if (tries >= BACKOFF_MS.length) {
			// Given up for now, but not for the session: forget it so a later
			// render can start over rather than inheriting today's bad minute.
			cache.delete(url);
			return null;
		}
		await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[tries]));
		return attempt(url, tries + 1);
	}
}

async function load(url: string): Promise<Card | null> {
	const host = hostOf(url);
	if (host === null) return null;
	const endpoint = oembedFor(url);
	if (endpoint) {
		// Straight to the service, as before: their oEmbed is public, sends
		// CORS, and knows more about their own media than og: tags do.
		const res = await fetch(endpoint).catch(() => {
			throw RETRY; // offline, or their service is having a moment
		});
		// A 404 from oEmbed is an answer — no such video, and there never
		// will be. A 5xx is them, not the link.
		if (!res.ok) throw res.status >= 500 ? RETRY : null;
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
	// A refusal is not an absence. The ration and a dead network both arrive
	// here as !ok, and both are worth asking about again; 204 — the server
	// looked and there was nothing — arrives as ok with no data, and that one
	// is the answer worth keeping.
	if (!res.ok) throw RETRY;
	if (!res.data) return null;
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
