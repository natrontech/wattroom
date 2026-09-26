import { describe, expect, it } from 'vitest';
import type { CrewChannel } from '$lib/channels';
import { deleteQuestion, playingIn } from './playlist-autoplay';

const channel = (
	name: string,
	playlistId?: string,
	kind: 'voice' | 'text' = 'voice',
) =>
	({
		id: name,
		kind,
		name,
		position: 0,
		private: false,
		autoplay: playlistId
			? { enabled: true, order: 'ordered', playlistId }
			: undefined,
	}) as CrewChannel;

// Deleting a crew playlist a voice channel's autoplay plays (#2884): the
// channel loses it for everyone, and Undo re-creates the playlist under a
// new id the channel no longer points at — so the delete asks first.
describe('a playlist a channel plays', () => {
	it('names the voice channels whose autoplay plays it', () => {
		const channels = [
			channel('Lounge', 'p1'),
			channel('Garage', 'p2'),
			channel('Pain Cave', 'p1'),
			channel('general', 'p1', 'text'),
		];
		expect(playingIn(channels, 'p1')).toEqual(['Lounge', 'Pain Cave']);
		expect(playingIn(channels, 'p3')).toEqual([]);
	});

	it('asks with the channel named and what cannot come back', () => {
		const q = deleteQuestion('Sunday Climb', ['Lounge']);
		expect(q.body).toContain('Lounge');
		expect(q.body).toMatch(/Undo/);
		expect(q.action).toBe('Delete the playlist');
		// The safe answer is the dialog's own "Keep it" (confirm.svelte).
		expect(q.cancel).toBeUndefined();
	});
});
