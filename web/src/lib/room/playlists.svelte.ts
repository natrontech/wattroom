import { api } from '$lib/api';
import type { JukeboxCommand, JukeboxTrack } from '$lib/protocol';
import { readLink } from '$lib/room/jukebox-add';
import { resolvePlaylist, titleFor } from '$lib/room/youtube-playlist';

/**
 * Saved playlists (#627) — the shelf above the live queue: room playlists
 * (multiple per room, one markable active for autoplay, editable by any
 * member like every other jukebox control) and personal playlists (a
 * rider's own, usable in any room). Distinct from a queued-whole YouTube
 * playlist (`$lib/room/jukebox-add`'s `PastedLink['playlist']`) — that is
 * one live queue entry; this is a saved list of entries.
 */

export interface SavedPlaylist {
	id: string;
	name: string;
	trackCount: number;
	/** Room playlists only: is this the room's autoplay source. */
	active?: boolean;
	updatedAt: number;
}

export interface SavedTrack {
	id: string;
	videoId: string;
	title: string;
	positionSec?: number;
	playlistId?: string;
	playlistTitle?: string;
	tracks?: JukeboxTrack[];
}

export interface SavedPlaylistDetail {
	id: string;
	name: string;
	tracks: SavedTrack[];
}

export interface AutoplaySettings {
	enabled: boolean;
	order: 'ordered' | 'shuffled';
	fixedVideoId?: string;
	fixedVideoTitle?: string;
	activePlaylistId?: string;
}

/** Room and personal playlists are the same shape at two different bases. */
export function createPlaylistStore(base: string) {
	let entries = $state<SavedPlaylist[]>([]);
	let loaded = $state(false);

	async function refresh(): Promise<void> {
		const res = await api<{ playlists: SavedPlaylist[] }>(base);
		if (res.ok) entries = res.data?.playlists ?? [];
		loaded = true;
	}
	void refresh();

	return {
		get loaded(): boolean {
			return loaded;
		},
		get all(): SavedPlaylist[] {
			return entries;
		},
		refresh,
		detail(id: string) {
			return api<SavedPlaylistDetail>(`${base}/${id}`);
		},
		async create(name: string) {
			const res = await api<SavedPlaylist>(base, {
				method: 'POST',
				json: { name },
			});
			if (res.ok) await refresh();
			return res;
		},
		async rename(id: string, name: string) {
			const res = await api<SavedPlaylist>(`${base}/${id}`, {
				method: 'PUT',
				json: { name },
			});
			if (res.ok) await refresh();
			return res;
		},
		async remove(id: string): Promise<string | null> {
			const res = await api(`${base}/${id}`, { method: 'DELETE' });
			if (!res.ok) return res.error.message;
			await refresh();
			return null;
		},
		async addTrack(id: string, command: JukeboxCommand) {
			const res = await api<SavedTrack>(`${base}/${id}/tracks`, {
				method: 'POST',
				json: command,
			});
			if (res.ok) await refresh();
			return res;
		},
		async removeTrack(id: string, trackId: string): Promise<string | null> {
			const res = await api(`${base}/${id}/tracks/${trackId}`, {
				method: 'DELETE',
			});
			if (!res.ok) return res.error.message;
			await refresh();
			return null;
		},
	};
}

/** Appends a saved playlist's tracks onto the room's live queue. */
export function queueSavedPlaylist(slug: string, id: string) {
	return api<{ queued: number }>(`/api/rooms/${slug}/playlists/${id}/queue`, {
		method: 'POST',
	});
}

export function getAutoplay(slug: string) {
	return api<AutoplaySettings>(`/api/rooms/${slug}/autoplay`);
}

export function updateAutoplay(slug: string, settings: AutoplaySettings) {
	return api<AutoplaySettings>(`/api/rooms/${slug}/autoplay`, {
		method: 'PATCH',
		json: settings,
	});
}

/**
 * Turn a pasted link into what POST .../tracks needs — the same parser the
 * live add box uses. An ambiguous "video inside a playlist" link saves just
 * the video, the same call `addYouTubeUrl` makes for a link dropped in chat:
 * there is no room here to ask either.
 */
export async function commandFromLink(
	input: string,
): Promise<
	| { ok: true; command: JukeboxCommand; note?: string }
	| { ok: false; message: string }
> {
	const link = readLink(input);
	switch (link.kind) {
		case 'video':
		case 'both':
			return {
				ok: true,
				command: {
					action: 'add',
					videoId: link.videoId,
					title: await titleFor(link.videoId),
					positionSec: link.startSec || undefined,
				},
			};
		case 'playlist':
			try {
				const resolved = await resolvePlaylist(link.playlistId);
				if (!resolved.tracks.length)
					return { ok: false, message: 'That playlist is empty.' };
				return {
					ok: true,
					command: {
						action: 'add',
						playlistId: resolved.playlistId,
						playlistTitle: resolved.playlistTitle,
						tracks: resolved.tracks,
					},
					note: resolved.truncated
						? `Saved the first ${resolved.tracks.length} tracks — the player reads no further into a playlist.`
						: undefined,
				};
			} catch {
				return {
					ok: false,
					message:
						'That playlist could not be read — it may be private or unlisted. A public playlist works.',
				};
			}
		case 'error':
			return { ok: false, message: link.message };
	}
}

/** A single video only, for the autoplay "fixed start" field. */
export async function singleVideoFromLink(
	input: string,
): Promise<
	{ ok: true; videoId: string; title: string } | { ok: false; message: string }
> {
	const link = readLink(input);
	if (link.kind === 'video' || link.kind === 'both')
		return {
			ok: true,
			videoId: link.videoId,
			title: await titleFor(link.videoId),
		};
	if (link.kind === 'playlist')
		return {
			ok: false,
			message: 'That is a playlist link — paste a single video instead.',
		};
	return { ok: false, message: link.message };
}
