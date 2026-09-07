import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chain the way `av.svelte.ts` could never be tested: one small mock for
 * the audio worklet, and a stub AudioContext. No `vi.mock('livekit-client')` —
 * this module has never heard of the SDK, which is the point of #892.
 */
vi.mock('$lib/room/mic-level', () => ({
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
}));

import { createMicChain, type MicChainHost } from './mic-chain.svelte';

let meterLevel: (n: number) => void = () => {};
const meterStop = vi.fn();

/** A capture track that remembers whether anyone is still listening for `ended`. */
function fakeTrack() {
	const listeners = new Set<() => void>();
	return {
		stop: vi.fn(),
		addEventListener: (_: string, fn: () => void) => listeners.add(fn),
		removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
		end: () => [...listeners].forEach((fn) => fn()),
		get watched() {
			return listeners.size;
		},
	};
}

let capture: ReturnType<typeof fakeTrack>;
let gain: { gain: { value: number; cancelScheduledValues: unknown } };
const ctxClose = vi.fn();

function stubAudio() {
	// Bound, not read through `capture`: a later stubAudio() must not retarget
	// the stream an already-open chain is holding.
	const track = fakeTrack();
	capture = track;
	const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
	gain = {
		gain: {
			value: 0,
			setTargetAtTime: vi.fn(),
		},
		connect: vi.fn(),
	} as never;
	vi.stubGlobal('AudioContext', function AudioContextStub(this: unknown) {
		return {
			currentTime: 0,
			state: 'running',
			createMediaStreamSource: () => ({}),
			createGain: () => gain,
			createMediaStreamDestination: () => ({
				stream: { getAudioTracks: () => [{ id: 'transmit' }] },
			}),
			close: ctxClose,
			destination: {},
		};
	});
	vi.stubGlobal('navigator', {
		mediaDevices: { getUserMedia: vi.fn(async () => stream) },
	});
	vi.stubGlobal('performance', { now: () => 0 });
}

function host(over: Partial<MicChainHost> = {}): MicChainHost {
	return {
		devices: { micId: '', forgetMicIfUnplugged: vi.fn(), refresh: vi.fn() },
		publish: vi.fn(async () => {}),
		unpublish: vi.fn(),
		live: () => true,
		heard: vi.fn(),
		silenced: vi.fn(),
		captureLost: vi.fn(),
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	stubAudio();
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

	it('reopening over a live chain does not orphan the old stream', async () => {
		const chain = createMicChain(host());
		await chain.open();
		const first = capture;
		stubAudio(); // the next open() gets a fresh capture
		await chain.open();
		expect(first.stop).toHaveBeenCalled();
	});
});

describe('the capture dying under an open mic (#640)', () => {
	it('raises a fault and tells the host', async () => {
		const deps = host();
		const chain = createMicChain(deps);
		await chain.open();

		capture.end();
		expect(chain.fault).toBe(true);
		expect(deps.captureLost).toHaveBeenCalled();
		expect(chain.transmitting).toBe(false);
	});

	it('only reopening clears it', async () => {
		const chain = createMicChain(host());
		await chain.open();
		capture.end();
		expect(chain.fault).toBe(true);

		stubAudio();
		await chain.open();
		expect(chain.fault).toBe(false);
	});
});

describe('what the room hears', () => {
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
