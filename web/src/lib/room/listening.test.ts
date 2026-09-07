import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	backIn,
	listening,
	playerAction,
	type Play,
} from '$lib/room/listening.svelte';

const A: Play = { videoId: 'aaa', anchorMs: 1_000 };
const B: Play = { videoId: 'bbb', anchorMs: 9_000 };
/** The same video queued again — a new play, not the one we walked out on. */
const AGAIN: Play = { videoId: 'aaa', anchorMs: 7_000 };

describe("sitting out the room's music (#989)", () => {
	beforeEach(() => listening.rejoin());

	it('leaves the chase alone while out, whatever the player holds', () => {
		// No seek and no rate nudge can be issued from either branch: the
		// only thing out does is unload once and then idle.
		expect(playerAction(true, true)).toBe('unload');
		expect(playerAction(true, false)).toBe('idle');
		expect(playerAction(false, false)).toBe('chase');
		expect(playerAction(false, true)).toBe('chase');
	});

	it('rejoins a skip when the room moves on', () => {
		listening.stepOut('skip', A, 300);
		listening.sees(A);
		expect(listening.out).toBe(true);

		listening.sees(B);
		expect(listening.out).toBe(false);
	});

	it('counts a repeat of the same video as the room moving on', () => {
		listening.stepOut('skip', A, 300);
		listening.sees(AGAIN);
		expect(listening.out).toBe(false);
	});

	it('rejoins a skip when the room stops playing anything', () => {
		listening.stepOut('skip', A, 300);
		listening.sees(null);
		expect(listening.out).toBe(false);
	});

	it('keeps a stop through any number of track changes', () => {
		listening.stepOut('stop', A, 300);
		listening.sees(B);
		listening.sees(AGAIN);
		listening.sees(null);
		expect(listening.out).toBe(true);
		expect(listening.mode).toBe('stop');

		listening.rejoin();
		expect(listening.out).toBe(false);
	});

	it('knows a length only for the play it measured', () => {
		listening.stepOut('stop', A, 300);
		expect(listening.durationOf(A)).toBe(300);
		expect(listening.durationOf(B)).toBe(0);
		expect(listening.durationOf(AGAIN)).toBe(0);
		expect(listening.durationOf(null)).toBe(0);
	});

	it('has no countdown without a duration', () => {
		// A livestream, or a rider who joined after the player had unloaded.
		listening.stepOut('skip', A, 0);
		expect(backIn(listening.durationOf(A), 12)).toBeNull();
	});

	it('counts down to the end of a track it measured', () => {
		listening.stepOut('skip', A, 300);
		expect(backIn(listening.durationOf(A), 286)).toBe(14);
		// A playhead past the end never runs the timer backwards.
		expect(backIn(listening.durationOf(A), 400)).toBe(0);
	});

	it('does not survive a reload', async () => {
		listening.stepOut('stop', A, 300);
		vi.resetModules();
		const fresh = await import('$lib/room/listening.svelte');
		expect(fresh.listening.out).toBe(false);
	});
});
