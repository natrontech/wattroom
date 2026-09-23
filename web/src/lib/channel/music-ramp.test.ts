import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMusicRamp } from './music-ramp';

// The dock's iframe has no gain node to glide, so a duck arrives as steps
// (#152). What matters is that it ARRIVES: the last step is the target, and a
// 0 ms move — what a fader gets — lands with no ramp at all.

let written: number[] = [];
const knob = {
	read: () => written.at(-1),
	write: (v: number) => written.push(v),
};

beforeEach(() => {
	vi.useFakeTimers();
	written = [];
});
afterEach(() => vi.useRealTimers());

describe('the music ramp (#152)', () => {
	it('lands on the target now when there is no time to take', () => {
		createMusicRamp(knob).to(64.4, 0);
		expect(written).toEqual([64]);
	});

	it('steps from where the player is to the target, and stops there', () => {
		written = [100];
		createMusicRamp(knob).to(25, 150);
		vi.advanceTimersByTime(150);
		expect(written.at(-1)).toBe(25);
		// 30 ms steps: five of them for a 150 ms attack, none after.
		expect(written).toEqual([100, 85, 70, 55, 40, 25]);
		vi.advanceTimersByTime(1_000);
		expect(written).toEqual([100, 85, 70, 55, 40, 25]);
	});

	it('starts at the target when the player will not say where it is', () => {
		const ramp = createMusicRamp({ read: () => undefined, write: knob.write });
		ramp.to(30, 60);
		vi.advanceTimersByTime(60);
		expect(written).toEqual([30, 30]);
	});

	it('abandons a ramp in flight for the newest target', () => {
		written = [100];
		const ramp = createMusicRamp(knob);
		ramp.to(0, 300);
		vi.advanceTimersByTime(60);
		ramp.to(100, 0);
		vi.advanceTimersByTime(1_000);
		expect(written.at(-1)).toBe(100);
	});

	it('stops where it got to when the dock goes away', () => {
		written = [100];
		const ramp = createMusicRamp(knob);
		ramp.to(0, 300);
		vi.advanceTimersByTime(60);
		const heard = written.length;
		ramp.stop();
		vi.advanceTimersByTime(1_000);
		expect(written.length).toBe(heard);
	});
});
