import { describe, expect, it } from 'vitest';
import { shareNotice } from './share-notice';

const place = { home: '/crew/c1/v/v1', name: 'Tuesday Spin' };

describe('shareNotice (#563)', () => {
	it('shows nothing until the screen is actually live', () => {
		expect(shareNotice(false, place, true)).toBe(null);
		// Sharing without a place is not a state we can reach — and if we do,
		// a notice pointing nowhere is worse than none.
		expect(shareNotice(true, null, false)).toBe(null);
	});

	// The browser's own "Stop sharing" bar ends the track behind our back and
	// resets av.sharing (av.svelte.ts). The notice derives from that flag and
	// from nothing else, so it goes out with it — no second copy of the state.
	it('goes as soon as sharing does', () => {
		let sharing = true;
		expect(shareNotice(sharing, place, true)).not.toBe(null);
		sharing = false;
		expect(shareNotice(sharing, place, true)).toBe(null);
	});

	it('names the place the screen is going to', () => {
		expect(shareNotice(true, place, true)?.name).toBe('Tuesday Spin');
	});

	// Walking out of the place does not stop the share, so the notice has to
	// carry the way back — and offer it only when there is somewhere to go.
	// Which pages are the place's own is onPlacePath's (address.test.ts).
	it('offers the way back only from outside the place', () => {
		expect(shareNotice(true, place, true)?.href).toBe(null);
		expect(shareNotice(true, place, false)?.href).toBe('/crew/c1/v/v1');
	});
});
