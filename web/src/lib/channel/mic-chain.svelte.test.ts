import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chain the way `av.svelte.ts` could never be tested: one small mock for
 * the audio worklet, and a stub AudioContext. No `vi.mock('livekit-client')` —
 * this module has never heard of the SDK, which is the point of #892.
 */
vi.mock('#lib/channel/mic-level.ts', () => ({
	createMicMeter: vi.fn(
		async (_ctx: unknown, _src: unknown, onLevel: (n: number) => void) => {
			meterLevel = onLevel;
			return {
				kind: 'worklet' as const,
				out: { connect: () => {} },
				stop: meterStop,
			};
		},
	),
	// No worklet by default: these tests drive the main-thread gate, and the
	// audio-thread one has its own (`voice-dsp.test.ts`, and below).
	createVoiceGate: vi.fn(async () => null),
}));

vi.mock('#lib/channel/denoiser.ts', () => ({ createDenoiser: vi.fn() }));

import { createDenoiser } from '#lib/channel/denoiser.ts';
import { createVoiceGate } from '#lib/channel/mic-level.ts';
import {
	DENOISE_WAIT_MS,
	SILENT_MS,
	createMicChain,
	type MicChainHost,
} from './mic-chain.svelte';

let meterLevel: (n: number) => void = () => {};
const meterStop = vi.fn();

/** A capture track that remembers whether anyone is still listening for `ended`. */
function fakeTrack() {
	const listeners = new Map<string, Set<() => void>>();
	const on = (type: string) =>
		listeners.get(type) ?? listeners.set(type, new Set()).get(type)!;
	return {
		muted: false,
		stop: vi.fn(),
		addEventListener: (type: string, fn: () => void) => on(type).add(fn),
		removeEventListener: (type: string, fn: () => void) => on(type).delete(fn),
		end: () => [...on('ended')].forEach((fn) => fn()),
		get watched() {
			return on('ended').size;
		},
	};
}

let capture: ReturnType<typeof fakeTrack>;
type FakeGain = {
	gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
};
/** Every gain node built, in order: the starting gain, then the gate's. */
let gains: FakeGain[];
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => stored.get(k) ?? null,
	setItem: (k: string, v: string) => void stored.set(k, v),
});
const ctxClose = vi.fn();
/** Whether anything built an audio graph at all — a handheld must not. */
const ctxMade = vi.fn();

function stubAudio() {
	// Bound, not read through `capture`: a later stubAudio() must not retarget
	// the stream an already-open chain is holding.
	const track = fakeTrack();
	capture = track;
	const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
	gains = [];
	vi.stubGlobal('AudioContext', function AudioContextStub(this: unknown) {
		ctxMade();
		return {
			currentTime: 0,
			state: 'running',
			createMediaStreamSource: () => ({ connect: vi.fn() }),
			createGain: () => {
				const node = {
					gain: { value: 1, setTargetAtTime: vi.fn() },
					connect: vi.fn(),
					disconnect: vi.fn(),
				};
				gains.push(node);
				return node;
			},
			createMediaStreamDestination: () => ({
				stream: { getAudioTracks: () => [{ id: 'transmit' }] },
			}),
			close: ctxClose,
			destination: {},
			resume: async () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
		};
	});
	vi.stubGlobal('navigator', {
		mediaDevices: { getUserMedia: vi.fn(async () => stream) },
	});
	vi.stubGlobal('performance', { now: () => 0 });
}

function host(over: Partial<MicChainHost> = {}): MicChainHost {
	return {
		devices: {
			micId: '',
			besideBluetooth: null,
			forgetMicIfUnplugged: vi.fn(),
			heardNothing: vi.fn(),
			refresh: vi.fn(async () => {}),
		},
		publish: vi.fn(async () => {}),
		unpublish: vi.fn(),
		live: () => true,
		heard: vi.fn(),
		silenced: vi.fn(),
		captureLost: vi.fn(),
		handheld: () => false,
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	stored.clear();
	stubAudio();
});

describe('a handheld', () => {
	// The silent one: a phone that builds the graph anyway still works — the
	// call hears it — and is still on the earpiece with a gate holding the
	// capture open, which is exactly what riders reported.
	it('publishes the capture itself and builds no audio graph', async () => {
		const deps = host({ handheld: () => true });
		const chain = createMicChain(deps);
		await chain.open();
		expect(deps.publish).toHaveBeenCalledWith(capture);
		expect(ctxMade).not.toHaveBeenCalled();
		expect(chain.transmitting).toBe(true);
	});
});

describe('opening and closing', () => {
	it('publishes the transmit track, not the raw capture', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();
		expect(deps.publish).toHaveBeenCalledWith({ id: 'transmit' });
	});

	it('closing unhooks the capture watch before stopping it', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();
		expect(capture.watched).toBe(1);

		chain.close();
		// A close the rider asked for is not a device fault (#640).
		expect(capture.watched).toBe(0);
		expect(capture.stop).toHaveBeenCalled();
		expect(deps.unpublish).toHaveBeenCalled();
		expect(chain.fault).toBe(false);
	});

	// #4161: an open takes seconds on a Bluetooth mic, and a mute, Away or
	// leave can land inside it. The silent one: the open used to finish
	// anyway, live behind a rider who had just closed it.
	it('a close while the mic is starting wins, and hands the capture back', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		const opening = chain.open();
		expect(chain.starting).toBe(true);
		chain.close();
		expect(chain.starting).toBe(false);
		await expect(opening).resolves.toBe(false);
		expect(capture.stop).toHaveBeenCalled();
		expect(deps.publish).not.toHaveBeenCalled();
	});

	it('a second open while the first is starting leaves one capture', async () => {
		const tracks: ReturnType<typeof fakeTrack>[] = [];
		vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
			async () => {
				const track = fakeTrack();
				tracks.push(track);
				return {
					getAudioTracks: () => [track],
					getTracks: () => [track],
				} as unknown as MediaStream;
			},
		);
		const chain = createMicChain(host());
		const first = chain.open();
		const second = chain.open();
		await expect(first).resolves.toBe(false);
		await expect(second).resolves.toBe(true);
		expect(tracks).toHaveLength(2);
		expect(tracks[0].stop).toHaveBeenCalled();
		expect(tracks[1].stop).not.toHaveBeenCalled();
	});

	it('reopening over a live chain does not orphan the old stream', async () => {
		const chain = createMicChain(host());
		await chain.open();
		const first = capture;
		stubAudio(); // the next open() gets a fresh capture
		await chain.open();
		expect(first.stop).toHaveBeenCalled();
	});
});

describe('the capture dying under an open mic (#640, #4220)', () => {
	it('opens again on what the machine has now, and stays live', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();

		const dying = capture;
		stubAudio();
		dying.end();
		await vi.waitFor(() => expect(deps.publish).toHaveBeenCalledTimes(2));
		expect(chain.fault).toBe(false);
		expect(deps.captureLost).not.toHaveBeenCalled();
	});

	it('raises a fault when the machine refuses the new capture', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();

		vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
			new Error('NotFoundError'),
		);
		capture.end();
		await vi.waitFor(() => expect(chain.fault).toBe(true));
		expect(deps.captureLost).toHaveBeenCalled();
		expect(chain.transmitting).toBe(false);
	});

	it('raises a fault when it dies again inside RECOVER_MS', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();
		const dying = capture;
		stubAudio();
		dying.end();
		await vi.waitFor(() => expect(deps.publish).toHaveBeenCalledTimes(2));

		capture.end();
		expect(chain.fault).toBe(true);
		expect(deps.captureLost).toHaveBeenCalled();
	});

	it('only reopening clears the fault', async () => {
		const chain = createMicChain(host());
		await chain.open();
		vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
			new Error('NotFoundError'),
		);
		capture.end();
		await vi.waitFor(() => expect(chain.fault).toBe(true));

		stubAudio();
		await chain.open();
		expect(chain.fault).toBe(false);
	});
});

describe('what the call hears', () => {
	it('is nothing while the gate is shut', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();
		meterLevel(0);
		expect(deps.heard).toHaveBeenLastCalledWith(0);
	});

	it('is nothing when this machine is not transmitting, however loud', async () => {
		const deps = host({ live: () => false });
		const chain = createMicChain(deps);
		await chain.open();
		meterLevel(1); // as loud as the meter goes
		expect(deps.heard).toHaveBeenLastCalledWith(0);
	});

	it('follows push-to-talk rather than the level', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();
		chain.setMode('ptt');

		chain.setPttHeld(true);
		expect(chain.transmitting).toBe(true);
		chain.setPttHeld(false);
		expect(chain.transmitting).toBe(false);
	});

	it('tells the audio-thread gate who decides: the call, push-to-talk, or the level', async () => {
		const set = vi.fn();
		let post: (s: {
			level: number;
			open: boolean;
			threshold: number;
		}) => void = () => {};
		vi.mocked(createVoiceGate).mockImplementationOnce(
			async (_c, _s, onState) => {
				post = onState;
				return {
					kind: 'worklet',
					out: { connect: () => {} } as unknown as AudioNode,
					set,
					stop: () => {},
				};
			},
		);
		let live = false;
		const deps = host({ live: () => live });
		const chain = createMicChain(deps);
		await chain.open();
		expect(set).toHaveBeenLastCalledWith(
			expect.objectContaining({ force: 'shut', auto: true }),
		);
		live = true;
		post({ level: 0.1, open: true, threshold: 0.012 });
		expect(set).toHaveBeenLastCalledWith(
			expect.objectContaining({ force: null }),
		);
		expect(chain.transmitting).toBe(true);
		expect(chain.effectiveThreshold).toBe(0.012);
		chain.setMode('ptt');
		expect(set).toHaveBeenLastCalledWith(
			expect.objectContaining({ force: 'shut' }),
		);
		chain.setPttHeld(true);
		expect(set).toHaveBeenLastCalledWith(
			expect.objectContaining({ force: 'open' }),
		);
		const calls = set.mock.calls.length;
		post({ level: 0.1, open: true, threshold: 0.012 });
		expect(set.mock.calls.length).toBe(calls); // nothing new, nothing sent
	});

	describe('noise cancellation', () => {
		const gate = { connect: vi.fn() } as unknown as AudioNode;
		const withGate = () =>
			vi.mocked(createVoiceGate).mockImplementationOnce(async () => ({
				kind: 'worklet',
				out: gate,
				set: () => {},
				stop: () => {},
			}));
		const denoiser = () => ({
			node: { connect: vi.fn() } as unknown as AudioNode,
			dispose: vi.fn(),
		});
		const settle = () => new Promise((resolve) => setTimeout(resolve));

		it('goes in front of the gate once it has loaded, and the mic never waits for it', async () => {
			withGate();
			const made = denoiser();
			let loaded = (_: typeof made) => {};
			vi.mocked(createDenoiser).mockImplementationOnce(
				() => new Promise((resolve) => (loaded = resolve)),
			);
			const chain = createMicChain(host());
			vi.useFakeTimers();
			const opening = chain.open();
			await vi.advanceTimersByTimeAsync(DENOISE_WAIT_MS);
			vi.useRealTimers();
			expect(await opening).toBe(true);
			const [lift] = gains;
			expect(lift.connect).not.toHaveBeenCalledWith(made.node);

			loaded(made);
			await settle();
			expect(lift.disconnect).toHaveBeenCalledWith(gate);
			expect(lift.connect).toHaveBeenCalledWith(made.node);
			expect(made.node.connect).toHaveBeenCalledWith(gate);
			expect(chain.noiseFault).toBe(false);
		});

		it('goes in before the track does when it is already here', async () => {
			withGate();
			const made = denoiser();
			vi.mocked(createDenoiser).mockResolvedValueOnce(made);
			const publish = vi.fn(async () => {
				expect(gains[0].connect).toHaveBeenCalledWith(made.node);
			});
			await createMicChain(host({ publish })).open();
			expect(publish).toHaveBeenCalled();
		});

		it('leaves a machine that cannot keep up on the gate alone, and says so', async () => {
			withGate();
			const made = denoiser();
			let overloaded = () => {};
			vi.mocked(createDenoiser).mockImplementationOnce(async (_, tooHeavy) => {
				overloaded = tooHeavy;
				return made;
			});
			const chain = createMicChain(host());
			await chain.open();
			await settle();
			const [lift] = gains;
			lift.connect.mockClear();

			overloaded();
			expect(made.dispose).toHaveBeenCalled();
			expect(lift.connect).toHaveBeenCalledWith(gate);
			expect(chain.noiseFault).toBe(true);
		});

		it('keeps the mic when it cannot load, and says so', async () => {
			withGate();
			vi.mocked(createDenoiser).mockRejectedValueOnce(new Error('no wasm'));
			const chain = createMicChain(host());
			expect(await chain.open()).toBe(true);
			await settle();
			expect(chain.noiseFault).toBe(true);
			expect(gains[0].disconnect).not.toHaveBeenCalled();
		});

		it('hands back one that loads after the mic closed', async () => {
			withGate();
			const made = denoiser();
			let loaded = (_: typeof made) => {};
			vi.mocked(createDenoiser).mockImplementationOnce(
				() => new Promise((resolve) => (loaded = resolve)),
			);
			const deps = host();
			const chain = createMicChain(deps);
			const opening = chain.open();
			await settle();
			chain.close();
			loaded(made);
			expect(await opening).toBe(false);
			await settle();
			expect(deps.publish).not.toHaveBeenCalled();
			expect(made.dispose).toHaveBeenCalled();
			expect(chain.noiseFault).toBe(false);
		});

		it('comes out when the rider turns it off, and that is no fault', async () => {
			withGate();
			const made = denoiser();
			vi.mocked(createDenoiser).mockResolvedValueOnce(made);
			const chain = createMicChain(host());
			await chain.open();
			await settle();
			chain.setNoiseSuppression(false);
			expect(made.dispose).toHaveBeenCalled();
			expect(gains[0].connect).toHaveBeenLastCalledWith(gate);
			expect(chain.noiseFault).toBe(false);
		});
	});

	it('opens for a held Talk in voice activation, and shuts after it over a quiet room (#4163)', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();
		meterLevel(0);
		expect(chain.transmitting).toBe(false);

		chain.setPttHeld(true);
		expect(chain.transmitting).toBe(true);
		// Under the threshold, and still you speaking: your own tile lights.
		meterLevel(0.01);
		expect(deps.heard).toHaveBeenLastCalledWith(0.01);
		chain.setPttHeld(false);
		meterLevel(0);
		expect(chain.transmitting).toBe(false);
	});

	it('leaves push-to-talk with the gate shut, not with the button stuck', async () => {
		const chain = createMicChain(host());
		await chain.open();
		chain.setMode('ptt');
		chain.setPttHeld(true);
		expect(chain.transmitting).toBe(true);

		chain.setMode('gate');
		expect(chain.transmitting).toBe(false);
	});
});

describe('the mic test (#178)', () => {
	it('never runs over a live mic', async () => {
		const chain = createMicChain(host());
		await chain.open();
		await chain.startTest();
		expect(chain.testing).toBe(false);
	});

	it('opens the rider’s own ears and closes the chain when it stops', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.startTest();
		expect(chain.testing).toBe(true);
		// The grant just made the device labels readable (#658).
		expect(deps.devices.refresh).toHaveBeenCalled();

		chain.stopTest();
		expect(chain.testing).toBe(false);
		expect(capture.stop).toHaveBeenCalled();
		expect(deps.silenced).toHaveBeenCalled();
	});
});

describe('the starting gain (#2120)', () => {
	it('lifts a quiet start toward where this device last settled', async () => {
		stored.set('wattroom.voice.settled.v1', JSON.stringify({ '': 0.3 }));
		const chain = createMicChain(host());
		await chain.open();
		meterLevel(0.15); // AGC's quiet first minute
		const [lift] = gains;
		expect(lift.gain.setTargetAtTime).toHaveBeenLastCalledWith(
			2,
			0,
			expect.any(Number),
		);
	});

	// #4161 may open the computer's mic for a rider who picked none: its lift
	// is that mic's, not the default's.
	it('remembers the mic it opened, not the one the rider left unpicked', async () => {
		stored.set('wattroom.voice.settled.v1', JSON.stringify({ mac: 0.3 }));
		const deps = host();
		deps.devices = { ...deps.devices, besideBluetooth: { deviceId: 'mac' } };
		const chain = createMicChain(deps);
		await chain.open();
		meterLevel(0.15);
		expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
			2,
			0,
			expect.any(Number),
		);
	});

	it('leaves a device with no settled call alone', async () => {
		const chain = createMicChain(host());
		await chain.open();
		meterLevel(0.15);
		expect(gains[0].gain.setTargetAtTime).not.toHaveBeenCalled();
	});
});

// #4161: a MacBook's mic is cut off in hardware while its lid is shut, and
// macOS still lists it. Chosen for the rider beside Bluetooth headphones, it
// would leave them talking to nobody with the mic drawn open.
describe('a chosen mic that hears nothing', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function chosen() {
		const deps = host();
		deps.devices = { ...deps.devices, besideBluetooth: { deviceId: 'mac' } };
		return deps;
	}

	it('goes back to the default after SILENT_MS of pure silence', async () => {
		const deps = chosen();
		const chain = createMicChain(deps);
		await chain.open();
		meterLevel(0);
		await vi.advanceTimersByTimeAsync(SILENT_MS);
		expect(deps.devices.heardNothing).toHaveBeenCalledWith('mac');
		expect(deps.publish).toHaveBeenCalledTimes(2);
	});

	it('stays once it has heard the room', async () => {
		const deps = chosen();
		const chain = createMicChain(deps);
		await chain.open();
		meterLevel(0.0004);
		await vi.advanceTimersByTimeAsync(SILENT_MS);
		expect(deps.devices.heardNothing).not.toHaveBeenCalled();
		expect(deps.publish).toHaveBeenCalledTimes(1);
	});
});
