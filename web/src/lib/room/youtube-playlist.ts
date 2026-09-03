import type { JukeboxTrack } from '$lib/protocol';
import { withYouTubeApi, type YTPlayer } from '$lib/room/youtube-api';

/**
 * Reading a YouTube playlist without an API key (#615).
 *
 * The player itself knows how to enumerate a playlist, so a second, hidden
 * player CUES one — never loads it, so nothing ever plays — and hands back
 * the ids via `getPlaylist()`. That keeps the server knowing nothing about
 * YouTube (docs/ARCHITECTURE.md's seam), costs no API key and no quota, and
 * works the same for a self-hoster as for wattroom.ch. `playlistItems.list`
 * stays the documented upgrade if this ever proves flaky (ADR-0025).
 */

/** The player loads at most this many of a playlist's videos. */
export const PLAYLIST_LIMIT = 50;

/** Titles cost a request each, so nothing is ever asked for twice. */
const titles = new Map<string, string>();

/** Resolve one title via keyless oEmbed; failure costs only the label. */
export async function titleFor(videoId: string): Promise<string> {
	const cached = titles.get(videoId);
	if (cached) return cached;
	let title = videoId;
	try {
		const res = await fetch(
			`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
		);
		if (res.ok) title = (await res.json()).title || videoId;
	} catch {
		/* the id is a workable label */
	}
	titles.set(videoId, title);
	return title;
}

/** The playlist's own name, for the row the queue shows. */
async function playlistTitleFor(playlistId: string): Promise<string> {
	try {
		const res = await fetch(
			`https://www.youtube.com/oembed?url=https://www.youtube.com/playlist?list=${playlistId}&format=json`,
		);
		if (res.ok) return (await res.json()).title || 'a playlist';
	} catch {
		/* the count alone still names it usefully */
	}
	return 'a playlist';
}

/** Ids only, from a player that cues the playlist and never plays it. */
function playlistIds(playlistId: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const host = document.createElement('div');
		// Off-screen rather than display:none — a player in a hidden subtree
		// is not guaranteed to initialise, and this one must reach ready.
		host.style.cssText =
			'position:fixed;left:-9999px;top:0;width:200px;height:200px;pointer-events:none';
		host.setAttribute('aria-hidden', 'true');
		document.body.appendChild(host);

		let player: YTPlayer | null = null;
		let poll: ReturnType<typeof setInterval> | undefined;
		let done = false;
		const finish = (ids: string[] | null, err?: string) => {
			if (done) return;
			done = true;
			clearInterval(poll);
			player?.destroy?.();
			host.remove();
			if (ids) resolve(ids);
			else reject(new Error(err ?? 'unreadable'));
		};

		// A playlist that never answers must not leave the add box spinning.
		const timeout = setTimeout(() => finish(null, 'timeout'), 12_000);

		withYouTubeApi(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			player = new (window as any).YT.Player(host, {
				width: 200,
				height: 200,
				host: 'https://www.youtube-nocookie.com',
				playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
				events: {
					onReady: () => {
						// CUE, never load: cueing readies the playlist without
						// starting playback, so this player is a reader and
						// never a second thing making noise in the room.
						player?.cuePlaylist?.({
							listType: 'playlist',
							list: playlistId,
						});
						poll = setInterval(() => {
							const ids = player?.getPlaylist?.();
							if (ids?.length) {
								clearTimeout(timeout);
								finish(ids.slice(0, PLAYLIST_LIMIT));
							}
						}, 150);
					},
					onError: () => {
						clearTimeout(timeout);
						finish(null, 'unavailable');
					},
				},
			});
		});
	});
}

export interface ResolvedPlaylist {
	playlistId: string;
	playlistTitle: string;
	tracks: JukeboxTrack[];
	/** Set when YouTube held more than the player would load. */
	truncated: boolean;
}

/**
 * A pasted playlist link, resolved into what the queue entry needs. Titles go
 * out in parallel: they are independent keyless requests, and asking for
 * fifty in series is the difference between a second and most of a minute.
 */
export async function resolvePlaylist(
	playlistId: string,
): Promise<ResolvedPlaylist> {
	const ids = await playlistIds(playlistId);
	const [playlistTitle, ...names] = await Promise.all([
		playlistTitleFor(playlistId),
		...ids.map(titleFor),
	]);
	return {
		playlistId,
		playlistTitle,
		tracks: ids.map((videoId, i) => ({ videoId, title: names[i] ?? videoId })),
		truncated: ids.length >= PLAYLIST_LIMIT,
	};
}
