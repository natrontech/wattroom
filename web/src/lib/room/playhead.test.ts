import { describe, expect, it } from 'vitest';
import { chase, clampSeek, playheadAt } from '$lib/room/playhead';

describe('chase', () => {
	it('seeks a real gap, in either direction', () => {
		expect(chase(120, 100, false)).toEqual({ do: 'seek', to: 120 });
		expect(chase(100, 120, false)).toEqual({ do: 'seek', to: 100 });
	});

	it('plays straight inside the threshold rather than nudging the rate', () => {
		// A 25 % tempo step (the smallest YouTube honours) is a worse
		// artefact on music than a second of drift — #286.
		expect(chase(101, 100, false)).toEqual({ do: 'hold' });
		expect(chase(100.2, 100, false)).toEqual({ do: 'hold' });
	});

	it('never seeks a livestream, however far the anchor has walked', () => {
		// The room anchor counts from the moment the stream was queued; the
		// player's clock is the stream's own. Chasing that seeks every tick.
		expect(chase(30, 7200, true)).toEqual({ do: 'hold' });
	});
});

describe('playheadAt', () => {
	const deck = { positionSec: 30, anchorMs: 1_000_000, playing: true };

	it('walks with wall time while playing, and holds while paused', () => {
		expect(playheadAt(deck, 1_010_000)).toBe(40);
		expect(playheadAt({ ...deck, playing: false }, 1_010_000)).toBe(30);
	});

	it('never runs past a known duration, and never below zero', () => {
		expect(playheadAt(deck, 1_600_000, 100)).toBe(100);
		expect(playheadAt({ ...deck, positionSec: -5, playing: false }, 0)).toBe(0);
	});
});

describe('clampSeek', () => {
	it('stops a scrub short of the end, and at the server cap without one', () => {
		expect(clampSeek(500, 120)).toBe(119);
		expect(clampSeek(-30)).toBe(0);
		expect(clampSeek(99_999)).toBe(6 * 3600);
	});
});
