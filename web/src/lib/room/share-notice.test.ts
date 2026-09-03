import { describe, expect, it } from 'vitest';
import { shareNotice } from './share-notice';

const room = { slug: 'sweet-spot', name: 'Sweet Spot' };

describe('shareNotice (#563)', () => {
	it('shows nothing until the screen is actually live', () => {
		expect(shareNotice(false, room, '/r/sweet-spot')).toBe(null);
		// Sharing without a room is not a state we can reach — and if we do,
		// a notice pointing nowhere is worse than none.
		expect(shareNotice(true, null, '/home')).toBe(null);
	});

	// The browser's own "Stop sharing" bar ends the track behind our back and
	// resets av.sharing (av.svelte.ts). The notice derives from that flag and
	// from nothing else, so it goes out with it — no second copy of the state.
	it('goes as soon as sharing does', () => {
		let sharing = true;
		expect(shareNotice(sharing, room, '/r/sweet-spot')).not.toBe(null);
		sharing = false;
		expect(shareNotice(sharing, room, '/r/sweet-spot')).toBe(null);
	});

	it('names the room the screen is going to', () => {
		expect(shareNotice(true, room, '/r/sweet-spot')?.room).toBe('Sweet Spot');
		// Before presence has named it, the slug still beats "a room".
		expect(shareNotice(true, { slug: 'sweet-spot' }, '/home')?.room).toBe(
			'sweet-spot',
		);
	});

	// Walking out of the room does not stop the share, so the notice has to
	// carry the way back — and offer it only when there is somewhere to go.
	it('offers the way back only from outside the room', () => {
		expect(shareNotice(true, room, '/r/sweet-spot')?.href).toBe(null);
		expect(shareNotice(true, room, '/r/sweet-spot/chat')?.href).toBe(null);
		expect(shareNotice(true, room, '/history')?.href).toBe('/r/sweet-spot');
		// A different room whose slug merely starts the same way is outside.
		expect(shareNotice(true, room, '/r/sweet-spot-2')?.href).toBe(
			'/r/sweet-spot',
		);
	});
});
