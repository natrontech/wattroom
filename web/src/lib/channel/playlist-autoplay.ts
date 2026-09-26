import type { CrewChannel } from '$lib/channels';
import type { ConfirmRequest } from '$lib/confirm.svelte';

/**
 * A crew playlist a voice channel's autoplay plays (#2884). Deleting it
 * stops that channel's autoplay for everyone in it — the column is set to
 * null — and Undo re-creates the playlist under a new id the channel no
 * longer points at. A cost paid by other people that no undo can put back
 * is errors.md's case for asking first (#1493).
 */
export function playingIn(
	channels: CrewChannel[],
	playlistId: string,
): string[] {
	return channels
		.filter((c) => c.kind === 'voice' && c.autoplay?.playlistId === playlistId)
		.map((c) => c.name);
}

/** The question, naming the channels and what cannot come back. */
export function deleteQuestion(
	name: string,
	channels: string[],
): ConfirmRequest {
	const where = channels.join(', ');
	return {
		title: `Delete “${name}”?`,
		body: `${where} ${channels.length === 1 ? 'plays' : 'play'} it when the queue runs dry. Deleting it stops that for everyone there, and Undo brings the tracks back but not the autoplay — someone has to choose a playlist for ${channels.length === 1 ? 'it' : 'them'} again.`,
		action: 'Delete the playlist',
	};
}
