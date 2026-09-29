import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CueId } from '$lib/sound/cue-catalogue';
import { createRideShift } from './ride-shift';
import { SHIFTER } from './shifter';

// #3330: a rider does not watch the screen, so every shift is heard — and
// only once: a cue per gear, `block` per press at an end, none on a repeat.
describe('the shift cues', () => {
	let cues: CueId[];
	let gear: number;
	const top = 3;
	const shift = () =>
		createRideShift(
			{
				easierHarder(dir) {
					const next = Math.min(top, Math.max(0, gear + dir));
					const moved = next !== gear;
					gear = next;
					return { moved };
				},
				atEnd: (dir) => (dir > 0 ? gear >= top : gear <= 0),
			},
			(id) => cues.push(id),
			() => Date.now(),
		);
	beforeEach(() => {
		vi.useFakeTimers();
		cues = [];
		gear = 1;
	});
	afterEach(() => vi.useRealTimers());

	it('plays exactly one cue for one shift, rising or falling', () => {
		const pair = shift();
		pair.press(1, 'screen');
		pair.release('screen');
		vi.advanceTimersByTime(1_000);
		expect(cues).toEqual(['shift-up']);
		pair.press(-1, 'screen');
		pair.release('screen');
		vi.advanceTimersByTime(1_000);
		expect(cues).toEqual(['shift-up', 'shift-down']);
		pair.stop();
	});

	it('plays block once per press at an end, and never on a held repeat', () => {
		gear = top;
		const pair = shift();
		pair.press(1, 'screen');
		// Held long enough for several repeats, all at the end.
		vi.advanceTimersByTime(SHIFTER.holdMs + SHIFTER.repeatMs * 4);
		pair.release('screen');
		expect(cues).toEqual(['block']);
		vi.advanceTimersByTime(SHIFTER.minGapMs);
		pair.press(1, 'screen');
		pair.release('screen');
		expect(cues).toEqual(['block', 'block']);
		pair.stop();
	});

	it('shifts through a held press to the end, then says nothing more', () => {
		gear = 0;
		const pair = shift();
		pair.press(1, 'screen');
		vi.advanceTimersByTime(SHIFTER.holdMs + SHIFTER.repeatMs * 6);
		pair.release('screen');
		expect(gear).toBe(top);
		expect(cues).toEqual(['shift-up', 'shift-up', 'shift-up']);
		pair.stop();
	});
});
