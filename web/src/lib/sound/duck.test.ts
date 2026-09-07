import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DUCK_ATTACK_MS,
	DUCK_HOLD_MS,
	DUCK_RELEASE_MS,
} from '$lib/sound/ducking';
import {
	type DuckStep,
	ducking,
	onDuck,
	resetDucking,
	setDucking,
} from '$lib/sound/duck';

let steps: DuckStep[] = [];
const listen = () => onDuck((step) => steps.push(step));

beforeEach(() => {
	vi.useFakeTimers();
	resetDucking();
	steps = [];
});
afterEach(() => vi.useRealTimers());

describe('the one duck (#988)', () => {
	it('tells a listener where the mix already is, without a ramp', () => {
		listen();
		expect(steps).toEqual([{ down: false, ms: 0 }]);
	});

	it('goes down on the attack and comes back after the hold', () => {
		listen();
		steps = [];
		setDucking(true);
		expect(steps).toEqual([{ down: true, ms: DUCK_ATTACK_MS }]);

		steps = [];
		setDucking(false);
		vi.advanceTimersByTime(DUCK_HOLD_MS - 1);
		expect(steps).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(steps).toEqual([{ down: false, ms: DUCK_RELEASE_MS }]);
	});

	// A breath between sentences must not pump the mix.
	it('a voice returning inside the hold cancels the release', () => {
		listen();
		setDucking(true);
		steps = [];
		setDucking(false);
		vi.advanceTimersByTime(DUCK_HOLD_MS / 2);
		setDucking(true);
		vi.advanceTimersByTime(DUCK_HOLD_MS * 2);
		// Still down, and never told to move: it never left.
		expect(steps).toEqual([]);
		expect(ducking()).toBe(true);
	});

	it('does not restart the attack while it is already down', () => {
		listen();
		setDucking(true);
		steps = [];
		setDucking(true);
		setDucking(true);
		expect(steps).toEqual([]);
	});

	it('ignores being told to come up when it is already up', () => {
		listen();
		steps = [];
		setDucking(false);
		vi.advanceTimersByTime(DUCK_HOLD_MS * 2);
		expect(steps).toEqual([]);
	});

	/**
	 * The bug. The hold and the ramp used to live on timers created inside a
	 * Svelte effect, whose cleanup runs before every RE-RUN and not only on
	 * destroy — so a dependency changing inside the 600 ms hold cleared the
	 * timer that was going to bring the music back, and it sat at 25 % until
	 * the next duck cycle happened to end cleanly.
	 *
	 * Re-subscribing is what that re-run now amounts to, and it must not touch
	 * the envelope.
	 */
	it('survives a listener re-subscribing mid-hold', () => {
		const stop = listen();
		setDucking(true);
		setDucking(false);
		vi.advanceTimersByTime(DUCK_HOLD_MS / 2);

		// The effect re-runs: unsubscribe, subscribe again.
		stop();
		steps = [];
		listen();
		expect(steps).toEqual([{ down: true, ms: 0 }]);

		steps = [];
		vi.advanceTimersByTime(DUCK_HOLD_MS);
		expect(steps).toEqual([{ down: false, ms: DUCK_RELEASE_MS }]);
		expect(ducking()).toBe(false);
	});

	// One duck, not two: the cue bus and the jukebox are told at the same
	// instant, which is the second thing that was wrong with the timing.
	it('moves every listener together', () => {
		const a: DuckStep[] = [];
		const b: DuckStep[] = [];
		onDuck((s) => a.push(s));
		onDuck((s) => b.push(s));
		a.length = b.length = 0;
		setDucking(true);
		expect(a).toEqual([{ down: true, ms: DUCK_ATTACK_MS }]);
		expect(b).toEqual(a);
	});

	it('stops telling a listener that has gone', () => {
		const stop = listen();
		stop();
		steps = [];
		setDucking(true);
		expect(steps).toEqual([]);
	});
});
