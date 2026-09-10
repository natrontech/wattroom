import type { JukeboxCommand, JukeboxEntry } from '$lib/protocol';
import {
	commandFromEntry,
	type PlaylistStore,
	type SaveTarget,
} from '$lib/room/playlists.svelte';
import { toasts } from '$lib/toast.svelte';

/**
 * Putting what the room is hearing onto a shelf (#1427, #1517). A saved
 * playlist is a saved queue (ADR-0045), so the saving itself is one POST per
 * entry — what these add is the half a rider notices: being told what
 * happened, in one line, whether one row went or a whole queue did.
 *
 * They live here rather than in the deck's markup because the Music page
 * saves the same way from its own rows, and a save that says nothing reads
 * as a save that did not happen.
 */

/** One add command onto one shelf, and a word about it either way. */
export async function saveToPlaylist(
	store: PlaylistStore,
	target: { id: string; name: string },
	command: JukeboxCommand,
	label: string,
): Promise<void> {
	const res = await store.addTrack(target.id, command);
	toasts.push(
		res.ok ? `Saved “${label}” to “${target.name}”.` : res.error.message,
		res.ok ? undefined : { tone: 'error' },
	);
}

/** One live queue entry onto one of the shelves the deck offers. */
export function saveEntryTo(
	store: PlaylistStore,
	target: SaveTarget,
	entry: JukeboxEntry,
): Promise<void> {
	return saveToPlaylist(
		store,
		target,
		commandFromEntry(entry),
		entry.playlistTitle ?? entry.title,
	);
}

/** What the room is hearing tonight, kept as a room playlist named for today. */
function todaysName(): string {
	const day = new Date().toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
	});
	return `Up next · ${day}`;
}

/**
 * The deck and everything behind it, as a new playlist. Entries the server
 * refuses — somebody else's library track — are counted and said, not
 * silently dropped.
 */
export async function saveQueueAsPlaylist(
	store: PlaylistStore,
	entries: JukeboxEntry[],
): Promise<void> {
	if (!entries.length) return;
	const name = todaysName();
	const created = await store.create(name);
	if (!created.ok) {
		toasts.push(created.error.message, { tone: 'error' });
		return;
	}
	let saved = 0;
	for (const entry of entries) {
		const res = await store.addTrack(created.data!.id, commandFromEntry(entry));
		if (res.ok) saved++;
	}
	const left = entries.length - saved;
	toasts.push(
		`Saved ${saved} track${saved === 1 ? '' : 's'} to “${name}”.` +
			(left
				? ` ${left} ${left === 1 ? 'was' : 'were'} somebody else's music and stayed out.`
				: ''),
	);
}
