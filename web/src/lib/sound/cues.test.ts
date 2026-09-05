// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DUCK_ATTACK_MS,
	DUCK_DEFAULT,
	DUCK_HOLD_MS,
	DUCK_RELEASE_MS,
} from '$lib/sound/ducking';

/**
 * Enough of an AudioContext for the master bus to exist: what this test
 * watches is the automation scheduled on its gain, not any sound.
 */
type Automation =
	| { kind: 'target'; value: number; at: number; tau: number }
	| { kind: 'value'; value: number; at: number };

const scheduled: Automation[] = [];
let now = 0;

function fakeParam() {
	return {
		value: 0,
		setValueAtTime: (value: number, at: number) =>
			void scheduled.push({ kind: 'value', value, at }),
		setTargetAtTime: (value: number, at: number, tau: number) =>
			void scheduled.push({ kind: 'target', value, at, tau }),
		exponentialRampToValueAtTime: () => {},
	};
}

function fakeNode() {
	return {
		connect: () => {},
		start: () => {},
		stop: () => {},
		gain: fakeParam(),
		frequency: fakeParam(),
		detune: fakeParam(),
		Q: fakeParam(),
		threshold: fakeParam(),
		knee: fakeParam(),
		ratio: fakeParam(),
		attack: fakeParam(),
		release: fakeParam(),
		type: '',
	};
}

const master = fakeNode();

class FakeAudioContext {
	state = 'running';
	destination = {};
	get currentTime() {
		return now;
	}
	createGain = () => master;
	createDynamicsCompressor = fakeNode;
	createOscillator = fakeNode;
	createBiquadFilter = fakeNode;
	resume = async () => {};
}

vi.stubGlobal('AudioContext', FakeAudioContext);

/** The ramp `glideTo` schedules for a ramp that reads as `ms` long. */
const tau = (ms: number) => ms / 3000;

async function freshCues() {
	vi.resetModules();
	return await import('./cues');
}

describe('cue ducking follows the SPEC envelope (#675)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		scheduled.length = 0;
		now = 10;
	});
	afterEach(() => vi.useRealTimers());

	it('glides down over the attack, to the depth under the cue level', async () => {
		const cues = await freshCues();
		cues.play('go'); // opens the bus
		cues.setVolume(0.8);
		scheduled.length = 0;

		cues.setDucked(true);
		expect(scheduled).toEqual([
			{
				kind: 'target',
				value: 0.8 * DUCK_DEFAULT,
				at: 10,
				tau: tau(DUCK_ATTACK_MS),
			},
		]);
	});

	it('holds, then glides back up over the release — never a snap', async () => {
		const cues = await freshCues();
		cues.play('go');
		cues.setVolume(0.8);
		cues.setDucked(true);
		scheduled.length = 0;

		cues.setDucked(false);
		vi.advanceTimersByTime(DUCK_HOLD_MS - 1);
		expect(scheduled).toEqual([]);

		now = 20;
		vi.advanceTimersByTime(1);
		expect(scheduled).toEqual([
			{ kind: 'target', value: 0.8, at: 20, tau: tau(DUCK_RELEASE_MS) },
		]);
	});

	it('a voice returning inside the hold cancels the release', async () => {
		const cues = await freshCues();
		cues.play('go');
		cues.setDucked(false);
		cues.setDucked(true);
		cues.setDucked(false);
		cues.setDucked(true);
		vi.advanceTimersByTime(DUCK_HOLD_MS * 2);
		expect(scheduled.filter((a) => a.value === 0.7)).toEqual([]);
	});

	it('a knob turned mid-duck re-aims the dip and leaves the release alone', async () => {
		const cues = await freshCues();
		cues.play('go');
		cues.setDucked(true);
		cues.setDucked(false);
		scheduled.length = 0;

		cues.setDuckLevel(0.5);
		expect(scheduled).toEqual([
			{ kind: 'target', value: 0.7 * 0.5, at: 10, tau: tau(DUCK_ATTACK_MS) },
		]);
		vi.advanceTimersByTime(DUCK_HOLD_MS);
		expect(scheduled.at(-1)).toEqual({
			kind: 'target',
			value: 0.7,
			at: 10,
			tau: tau(DUCK_RELEASE_MS),
		});
	});

	it('a fader move and a mute act now, ducked or not', async () => {
		const cues = await freshCues();
		cues.play('go');
		cues.setDucked(true);
		scheduled.length = 0;

		cues.setVolume(0.5);
		cues.setMuted(true);
		expect(scheduled).toEqual([
			{ kind: 'value', value: 0.5 * DUCK_DEFAULT, at: 10 },
			{ kind: 'value', value: 0, at: 10 },
		]);
	});

	it('starts from the SPEC depth before the mixer has spoken', async () => {
		const cues = await freshCues();
		cues.play('go');
		scheduled.length = 0;
		cues.setDucked(true);
		expect(scheduled[0]?.value).toBeCloseTo(0.7 * DUCK_DEFAULT);
	});
});
