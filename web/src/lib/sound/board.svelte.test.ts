// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audition (#981): a clip played to this machine alone. It shares `play` with
 * a fire from the tick, so what this pins is the bookkeeping around it — who
 * outranks whom, when the loop restarts, and where the playhead is.
 *
 * Enough of an AudioContext for a buffer source to be scheduled; no sound is
 * made and none is listened for.
 */
let now = 0;
const started: { start: number; kept: number }[] = [];
let ended: (() => void) | undefined;

function fakeParam() {
	return {
		value: 0,
		setValueAtTime: () => {},
		linearRampToValueAtTime: () => {},
		setTargetAtTime: () => {},
	};
}

function fakeSource() {
	const node = {
		buffer: null as unknown,
		connect: () => {},
		disconnect: () => {},
		onended: undefined as (() => void) | undefined,
		start: (_at: number, start: number, kept: number) => {
			started.push({ start, kept });
			ended = () => node.onended?.();
		},
		stop: () => {
			node.onended?.();
		},
	};
	return node;
}

vi.mock('$lib/sound/cues', () => ({
	bus: () => ({
		ctx: {
			get currentTime() {
				return now;
			},
			createGain: () => ({
				connect: () => {},
				disconnect: () => {},
				gain: fakeParam(),
			}),
			createBufferSource: fakeSource,
			decodeAudioData: async () => ({ duration: 4, getChannelData: () => [] }),
		},
		input: {},
	}),
}));

vi.mock('$lib/sound/mixer.svelte', () => ({
	mixer: { muted: false, board: 1, riderGain: () => 1 },
}));

const { fire, forget, preview, previewAt, previewing, stopPreview } =
	await import('$lib/sound/board.svelte');

const ME = 'rider-me';

/** Only the two numbers each test cares about; the rest are the flat defaults. */
const trim = (startMs: number, endMs: number) => ({
	startMs,
	endMs,
	gainDb: 0,
	fadeInMs: 0,
	fadeOutMs: 0,
});

beforeEach(() => {
	now = 0;
	started.length = 0;
	ended = undefined;
	vi.stubGlobal('fetch', async () => ({
		ok: true,
		arrayBuffer: async () => new ArrayBuffer(8),
	}));
	forget();
});
afterEach(() => vi.unstubAllGlobals());

describe('audition', () => {
	it('says what it is playing, and stops on the second press', async () => {
		expect(previewing()).toBeNull();
		await preview('clip-a', ME);
		expect(previewing()).toBe('clip-a');
		stopPreview();
		expect(previewing()).toBeNull();
	});

	// The tick outranks a preview: one rider is one voice, and a fire is the
	// room's, not this machine's.
	it('gives way to a fire from the same rider', async () => {
		await preview('clip-a', ME);
		await fire('clip-b', ME);
		expect(previewing()).toBeNull();
	});

	it('loops by restarting, so every pass applies the fades', async () => {
		await preview('clip-a', ME, trim(500, 1500), true);
		expect(started).toHaveLength(1);
		expect(started[0]).toEqual({ start: 0.5, kept: 1 });
		// The pass ends; the audition is still the current one, so it goes again.
		ended?.();
		await vi.waitFor(() => expect(started).toHaveLength(2));
		expect(started[1]).toEqual({ start: 0.5, kept: 1 });
	});

	it('stops looping once the audition is stopped', async () => {
		await preview('clip-a', ME, undefined, true);
		stopPreview();
		const passes = started.length;
		ended?.();
		await new Promise((r) => setTimeout(r, 5));
		expect(started).toHaveLength(passes);
	});

	it('does not loop what was not asked to loop', async () => {
		await preview('clip-a', ME);
		expect(started).toHaveLength(1);
		ended?.();
		await new Promise((r) => setTimeout(r, 5));
		expect(started).toHaveLength(1);
	});

	it('puts the playhead where the audio clock says, and wraps on a loop', async () => {
		await preview('clip-a', ME, trim(0, 1000), true);
		expect(previewAt()).toBe(0);
		now = 0.4;
		expect(previewAt()).toBeCloseTo(0.4);
		// Past the end of the kept second, it is back near the start.
		now = 1.25;
		expect(previewAt()).toBeCloseTo(0.25);
		stopPreview();
		expect(previewAt()).toBeNull();
	});

	it('has no playhead when nothing is being auditioned', async () => {
		await fire('clip-a', ME);
		expect(previewAt()).toBeNull();
	});
});
