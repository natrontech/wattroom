import { describe, expect, it } from 'vitest';
import { chase, clampSeek, playheadAt } from '$lib/room/playhead';

describe('chase', () => {
	it('seeks a big gap and nudges a small one', () => {
		expect(chase(120, 100, false)).toEqual({ do: 'seek', to: 120 });
		expect(chase(101, 100, false)).toEqual({ do: 'rate', rate: 1.25 });
		expect(chase(99, 100, false)).toEqual({ do: 'rate', rate: 0.75 });
	});

	it('plays straight inside the deadband', () => {
		expect(chase(100.2, 100, false)).toEqual({ do: 'rate', rate: 1 });
	});

	it('never seeks a livestream, however far the anchor has walked', () => {
		// The room anchor counts from the moment the stream was queued; the
		// player's clock is the stream's own. Chasing that seeks every tick.
		expect(chase(30, 7200, true)).toEqual({ do: 'rate', rate: 1 });
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
