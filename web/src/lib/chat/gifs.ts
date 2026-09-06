/**
 * The GIF picker's data half (#878, ADR-0032). The server proxies Tenor and
 * hands back only URLs `gifUrl()` in ./media.ts agrees to render, so what a
 * picked tile posts is an ordinary chat message that draws itself.
 */
import { api, type ApiResult } from '$lib/api';

export interface Gif {
	id: string;
	/** The full-size GIF — this string IS the message when a tile is picked. */
	url: string;
	/** The small one the grid draws. */
	preview: string;
	width: number;
	height: number;
	alt: string;
}

export interface GifPage {
	results: Gif[];
	/** Tenor's cursor; absent when the results ran out. */
	next?: string;
}

/** No query asks for what Tenor is featuring — the grid is never empty. */
export function searchGifs(
	query: string,
	cursor?: string,
): Promise<ApiResult<GifPage>> {
	const params = new URLSearchParams();
	if (query.trim()) params.set('q', query.trim());
	if (cursor) params.set('pos', cursor);
	const qs = params.toString();
	return api<GifPage>(`/api/gifs${qs ? `?${qs}` : ''}`);
}
