import type { JukeboxCommand } from '$lib/protocol';
import {
	resolvePlaylist,
	titleFor,
	type ResolvedPlaylist,
} from '$lib/room/youtube-playlist';

/** "94", "94s", "1m34s", "1h2m3s" — the forms YouTube puts in ?t=. */
function startSecFrom(u: URL): number {
	const raw = u.searchParams.get('t') ?? u.searchParams.get('start') ?? '';
	const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
	if (!raw || !m) return 0;
	return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Lists that cannot become a queue entry, each with the reason a rider needs
 * to read. Refusing in silence was the old behaviour for every `?list=` and
 * it read as the paste being ignored (errors.md: say what, why, and what to
 * do). The server checks only the id's shape — the vocabulary lives here,
 * with the person who can act on it.
 */
function refuseList(id: string): string | null {
	if (/^RD/.test(id))
		return 'That is a YouTube mix, which never ends — open the playlist itself, or queue just the video.';
	if (id === 'LL' || id === 'WL')
		return 'Liked videos and Watch Later are private to your account, so the room cannot load them. Make a public playlist instead.';
	return null;
}

/** What a pasted link turns out to be. */
export type PastedLink =
	| { kind: 'video'; videoId: string; startSec: number }
	| { kind: 'playlist'; playlistId: string }
	/** A video inside a playlist: only the paster knows which they meant. */
	| { kind: 'both'; videoId: string; startSec: number; playlistId: string }
	| { kind: 'error'; message: string };

/** The one parser behind the add box, the chat's queue action, and #615. */
export function readLink(input: string): PastedLink {
	const trimmed = input.trim();
	if (VIDEO_ID.test(trimmed))
		return { kind: 'video', videoId: trimmed, startSec: 0 };

	let u: URL;
	try {
		u = new URL(trimmed);
	} catch {
		return {
			kind: 'error',
			message: 'That does not look like a YouTube link or video id.',
		};
	}

	const list = u.searchParams.get('list') ?? '';
	const v = u.searchParams.get('v') ?? '';
	const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
	const videoId = VIDEO_ID.test(v) ? v : VIDEO_ID.test(last) ? last : '';
	const startSec = startSecFrom(u);

	if (list) {
		const refusal = refuseList(list);
		// A list nobody can read, next to a perfectly good video, is not an
		// error: queue the video rather than lecturing about the list.
		if (refusal)
			return videoId
				? { kind: 'video', videoId, startSec }
				: { kind: 'error', message: refusal };
		if (videoId) return { kind: 'both', videoId, startSec, playlistId: list };
		return { kind: 'playlist', playlistId: list };
	}
	if (videoId) return { kind: 'video', videoId, startSec };
	return {
		kind: 'error',
		message: 'That does not look like a YouTube link or video id.',
	};
}

/** The still-frame YouTube serves from its cookieless CDN — the queue's art. */
export function thumbnailFor(videoId: string): string {
	return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** Queue one video; a pasted ?t= starts it at the good part for everyone. */
export async function queueVideo(
	videoId: string,
	startSec: number,
	send: (command: JukeboxCommand) => void,
): Promise<void> {
	send({
		action: 'add',
		videoId,
		title: await titleFor(videoId),
		positionSec: startSec || undefined,
	});
}

/**
 * Send a playlist the caller already resolved. The add box resolves as soon
 * as it sees a `&list=`, so it can put the track count on the button that
 * queues it — a choice between "this video" and "the whole playlist" is not
 * a choice until you know how long the playlist is.
 */
export function queueResolvedPlaylist(
	resolved: ResolvedPlaylist,
	send: (command: JukeboxCommand) => void,
): void {
	send({
		action: 'add',
		playlistId: resolved.playlistId,
		playlistTitle: resolved.playlistTitle,
		tracks: resolved.tracks,
	});
}

/**
 * Queue a whole playlist as one entry. Resolution can take a moment and can
 * fail (a private list, a blocked iframe API), so the caller gets the reason
 * rather than a paste that quietly did nothing.
 */
export async function queuePlaylist(
	playlistId: string,
	send: (command: JukeboxCommand) => void,
): Promise<
	| { ok: true; count: number; truncated: boolean }
	| { ok: false; message: string }
> {
	let resolved;
	try {
		resolved = await resolvePlaylist(playlistId);
	} catch {
		return {
			ok: false,
			message:
				'That playlist could not be read — it may be private or unlisted. A public playlist works.',
		};
	}
	if (!resolved.tracks.length)
		return { ok: false, message: 'That playlist is empty.' };
	queueResolvedPlaylist(resolved, send);
	return {
		ok: true,
		count: resolved.tracks.length,
		truncated: resolved.truncated,
	};
}

/**
 * The no-questions path, for a link dropped in the chat (#146) where there is
 * no room to ask. A bare playlist link is unambiguous and goes in whole; a
 * video that merely SITS in a playlist queues as the video, because that is
 * the thing the message was about. The add box asks instead.
 */
export async function addYouTubeUrl(
	url: string,
	send: (command: JukeboxCommand) => void,
): Promise<boolean> {
	const link = readLink(url);
	switch (link.kind) {
		case 'video':
		case 'both':
			await queueVideo(link.videoId, link.startSec, send);
			return true;
		case 'playlist':
			return (await queuePlaylist(link.playlistId, send)).ok;
		case 'error':
			return false;
	}
}
