import { describe, expect, it } from 'vitest';
import { AUTO_MAX, AUTO_MIN, voiceDspOptions } from '$lib/channel/gate';
import { LOOKAHEAD, createVoiceDsp } from '$lib/channel/voice-dsp';

const SR = 48_000;
const Q = 128;

let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** Runs `signal` through the DSP a render quantum at a time. */
function run(dsp: ReturnType<typeof createVoiceDsp>, signal: Float32Array) {
	const out = new Float32Array(signal.length);
	for (let i = 0; i + Q <= signal.length; i += Q)
		dsp.process(signal.subarray(i, i + Q), out.subarray(i, i + Q));
	return out;
}

function make(seconds: number, at: (i: number) => number) {
	const x = new Float32Array(SR * seconds);
	for (let i = 0; i < x.length; i++) x[i] = at(i);
	return x;
}

const rms = (x: Float32Array, from: number, to: number) => {
	let s = 0;
	for (let i = from; i < to; i++) s += x[i] * x[i];
	return Math.sqrt(s / (to - from));
};

describe('voice dsp', () => {
	it('passes the voice through untouched, LOOKAHEAD samples late', () => {
		const dsp = createVoiceDsp(voiceDspOptions(SR));
		dsp.set({ force: 'open' });
		const x = make(1, (i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR));
		const y = run(dsp, x);
		for (let i = SR / 10; i < x.length; i++)
			expect(Math.abs(y[i] - x[i - LOOKAHEAD])).toBeLessThan(1e-5);
	});

	it('is open before the first sound of a word leaves the machine', () => {
		const dsp = createVoiceDsp(voiceDspOptions(SR));
		const onset = SR * 2;
		const x = make(3, (i) =>
			i < onset ? 1e-4 * noise() : 0.1 * Math.sin((2 * Math.PI * 300 * i) / SR),
		);
		const y = run(dsp, x);
		// The word's first 5 ms, as it reaches the call: all of it.
		const from = onset + LOOKAHEAD;
		expect(
			rms(y, from, from + 240) / rms(x, onset, onset + 240),
		).toBeGreaterThan(0.95);
		// And the room before it: nothing.
		expect(rms(y, SR, onset)).toBe(0);
	});

	it('sets its own mark from the room, and a voice does not move it', () => {
		const dsp = createVoiceDsp(voiceDspOptions(SR));
		// A fan at -48 dBFS RMS.
		run(
			dsp,
			make(6, () => 0.004 * Math.SQRT2 * noise()),
		);
		const room = dsp.threshold;
		expect(room).toBeGreaterThan(0.01);
		expect(room).toBeLessThan(0.02);
		// Five seconds of talking over it, four syllables a second.
		run(
			dsp,
			make(5, (i) => {
				const syllable = Math.max(0, Math.sin((2 * Math.PI * 4 * i) / SR)) ** 2;
				return 0.004 * Math.SQRT2 * noise() + 0.3 * syllable * noise();
			}),
		);
		expect(Math.abs(20 * Math.log10(dsp.threshold / room))).toBeLessThan(3);
		// A loud fan lifts it only to the ceiling; silence drops it to the floor.
		run(
			dsp,
			make(6, () => 0.05 * noise()),
		);
		expect(dsp.threshold).toBe(AUTO_MAX);
		run(
			dsp,
			make(6, () => 0),
		);
		expect(dsp.threshold).toBe(AUTO_MIN);
	});
});
