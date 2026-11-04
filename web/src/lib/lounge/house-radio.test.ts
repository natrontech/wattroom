import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHouseRadio } from '$lib/lounge/house-radio';
import { SLOT_SEC } from '$lib/lounge/station';
import { skipShift } from '$lib/lounge/state';

/** Every source the radio starts, by the audio time it asked for. */
let starts: number[] = [];
// Any node: every property is another node, connect hands back its target.
const node = (): unknown =>
	new Proxy(() => {}, {
		get: (_, key) =>
			key === 'connect'
				? (to: unknown) => to
				: key === 'start'
					? (t: number) => void starts.push(t)
					: node(),
		set: () => true,
	});
const ctx = {
	state: 'running' as AudioContextState,
	currentTime: 0,
	sampleRate: 100,
	destination: node(),
	createBuffer: (_: number, n: number) => ({
		getChannelData: () => new Float32Array(n),
	}),
	resume: async () => {},
	close: async () => {},
};
for (const make of [
	'createGain',
	'createOscillator',
	'createBiquadFilter',
	'createBufferSource',
	'createDelay',
	'createConvolver',
	'createDynamicsCompressor',
	'createPeriodicWave',
])
	Object.assign(ctx, { [make]: node });

// 60 s into a lofi tune: its groove, where every sixteenth has notes.
let server = 1000 * (SLOT_SEC * 100 + 60);
/** `ms` of time on the server's clock, the audio clock moving with it or not. */
function run(ms: number, audio: boolean) {
	for (let i = 0; i < ms; i += 25) {
		server += 25;
		if (audio) ctx.currentTime += 0.025;
		vi.advanceTimersByTime(25);
	}
	const laid = starts.length;
	starts = [];
	return laid;
}

describe('house radio', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('AudioContext', function () {
			return ctx;
		});
		ctx.state = 'running';
		ctx.currentTime = 0;
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('lays nothing while the context waits for a first click', () => {
		ctx.state = 'suspended';
		const radio = createHouseRadio('crew', () => server);
		radio.tune('lofi', 0, false);
		radio.start();
		// The graph's own LFOs and rain loop start when it is built.
		starts = [];
		expect(run(5000, false)).toBe(0);
		ctx.state = 'running';
		expect(run(2000, true)).toBeGreaterThan(0);
		radio.close();
	});

	it('never piles the music of a stalled audio clock onto one instant', () => {
		const radio = createHouseRadio('crew', () => server);
		radio.tune('lofi', 0, false);
		radio.start();
		starts = [];
		const twoSeconds = run(2000, true);
		expect(twoSeconds).toBeGreaterThan(10);
		// Headphones changing hands: the context runs, its clock does not.
		// What was already laid ahead plays; the five seconds after it do not.
		expect(run(5000, false)).toBeLessThan(twoSeconds / 2);
		expect(run(2000, true)).toBeGreaterThan(10);
		radio.close();
	});

	it('skips to the top of the next tune a second after Next, and lays nothing between', () => {
		const radio = createHouseRadio('crew', () => server);
		radio.tune('lofi', 0, false);
		radio.start();
		run(1000, true);
		const skippedAt = ctx.currentTime;
		radio.tune('lofi', skipShift('crew', 'lofi', 0, server), false);
		const laid: number[] = [];
		for (let i = 0; i < 80; i++) {
			server += 25;
			ctx.currentTime += 0.025;
			vi.advanceTimersByTime(25);
			laid.push(...starts);
			starts = [];
		}
		const after = laid.map((t) => t - skippedAt);
		expect(after.some((t) => t > 0.2 && t < 0.95)).toBe(false);
		expect(after.some((t) => t >= 0.95 && t < 1.6)).toBe(true);
		radio.close();
	});
});
