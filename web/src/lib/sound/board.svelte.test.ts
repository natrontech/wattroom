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
let stopped = 0;
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
			stopped++;
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

const {
	catchUp,
	fire,
	forget,
	isSounding,
	keepOnly,
	nameOf,
	preview,
	previewAt,
	previewing,
	stop,
	stopAll,
	stopPreview,
} = await import('$lib/sound/board.svelte');

const ME = 'rider-me';

/** Only the two numbers each test cares about; the rest are the flat defaults. */
const trim = (startMs: number, endMs: number) => ({
	startMs,
	endMs,
	gainDb: 0,
	fadeInMs: 0,
	fadeOutMs: 0,
});

/**
 * What the server says about a clip, by id — the description a LISTENER has
 * no other way to know (#1681). Untouched, a clip is the whole 4 s source
 * under a name.
 */
const served = new Map<string, Record<string, unknown>>();
const describe_ = (clipId: string) => ({
	name: 'CLIP',
	millis: 4000,
	...trim(0, 0),
	...(served.get(clipId) ?? {}),
});

beforeEach(() => {
	now = 0;
	started.length = 0;
	ended = undefined;
	served.clear();
	vi.stubGlobal('fetch', async (url: string) => ({
		ok: true,
		arrayBuffer: async () => new ArrayBuffer(8),
		json: async () => describe_(url.split('/')[4]),
	}));
	forget();
	// After forget: stopping the previous test's leftovers is not this test's.
	stopped = 0;
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

describe('stop', () => {
	it('ends what the rider has sounding, and nothing else', async () => {
		await fire('clip-a', ME);
		await fire('clip-b', 'rider-other');
		stop(ME);
		expect(stopped).toBe(1);
		// Nothing left of theirs: a second stop has nothing to stop.
		stop(ME);
		expect(stopped).toBe(1);
	});

	// A stop that landed while the clip was still being fetched found nothing
	// to stop, and the play then started anyway once the audio decoded — the
	// sound outlived the stop that was meant for it (#1321).
	it('outranks a play that is still loading', async () => {
		const pending = fire('clip-a', ME);
		stop(ME);
		await pending;
		expect(started).toHaveLength(0);
	});

	it('leaving the room ends a play that is still loading too', async () => {
		const pending = fire('clip-a', ME);
		stopAll();
		await pending;
		expect(started).toHaveLength(0);
	});

	it("does not restart this rider's loop when another rider's clip ends", async () => {
		await preview('clip-a', ME, undefined, true);
		await fire('clip-b', 'rider-other');
		const passes = started.length;
		// The other rider's clip ends; the loop is not its to restart.
		ended?.();
		await new Promise((r) => setTimeout(r, 5));
		expect(started).toHaveLength(passes);
	});
});

/**
 * The listener's half of a fire (#1681). A clip's trim, gain and fades used to
 * be read out of the firer's own library, which nobody else has — so the room
 * heard the whole uploaded source at raw level, and the rider who cut it was
 * the only person who heard the cut.
 */
describe('what a listener plays', () => {
	it("applies the owner's trim to somebody else's clip", async () => {
		served.set('clip-a', trim(500, 1500));
		await fire('clip-a', 'rider-other');
		expect(started).toEqual([{ start: 0.5, kept: 1 }]);
	});

	it('names the clip once it has been heard', async () => {
		expect(nameOf('clip-a')).toBeNull();
		served.set('clip-a', { name: 'AIRHORN' });
		await fire('clip-a', 'rider-other');
		expect(nameOf('clip-a')).toBe('AIRHORN');
	});

	// The trim face auditions an edit it has not saved: that one still wins.
	it('lets an unsaved edit outrank the stored one', async () => {
		served.set('clip-a', trim(500, 1500));
		await preview('clip-a', ME, trim(2000, 3000));
		expect(started).toEqual([{ start: 2, kept: 1 }]);
	});

	it('says who is making a noise, and stops saying it when they stop', async () => {
		expect(isSounding('rider-other')).toBe(false);
		await fire('clip-a', 'rider-other');
		expect(isSounding('rider-other')).toBe(true);
		stop('rider-other');
		expect(isSounding('rider-other')).toBe(false);
	});
});

/**
 * Joining mid-clip (#1681). A fire is one tick and gone, so the roster carries
 * what each rider still has sounding and how far in the room already is.
 */
describe('catching up', () => {
	it('starts what is left of a clip already running', async () => {
		await catchUp('clip-a', 'rider-other', 1000);
		expect(started).toEqual([{ start: 1, kept: 3 }]);
	});

	it('counts the offset from inside the trim, not the source', async () => {
		served.set('clip-a', trim(500, 2500));
		await catchUp('clip-a', 'rider-other', 500);
		expect(started).toEqual([{ start: 1, kept: 1.5 }]);
	});

	it('plays nothing for a clip the room has already finished', async () => {
		served.set('clip-a', trim(0, 1000));
		await catchUp('clip-a', 'rider-other', 2000);
		expect(started).toHaveLength(0);
	});

	// The roster keeps saying so for as long as the hub assumes the clip runs,
	// so this is asked every tick — and must not restart what the fire began.
	it('leaves a clip this machine is already playing alone', async () => {
		await fire('clip-a', 'rider-other');
		await catchUp('clip-a', 'rider-other', 900);
		expect(started).toHaveLength(1);
	});

	it('does start their NEXT clip', async () => {
		await fire('clip-a', 'rider-other');
		await catchUp('clip-b', 'rider-other', 0);
		expect(started).toHaveLength(2);
	});

	// Nothing else would ever end it: a stop is a message from a socket that
	// has gone.
	it('stops a rider who left the room mid-clip', async () => {
		await fire('clip-a', 'rider-other');
		await fire('clip-b', ME);
		keepOnly([ME]);
		expect(isSounding('rider-other')).toBe(false);
		expect(isSounding(ME)).toBe(true);
	});
});
