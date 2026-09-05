// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { GATE_CEIL, GATE_FLOOR } from './gate-scale';
import { mixer } from '$lib/sound/mixer.svelte';
import { pickStage } from '$lib/room/stage';

vi.mock('$lib/api', () => ({
	api: async () => ({ ok: true, data: { url: 'ws://livekit', token: 't' } }),
}));

vi.mock('livekit-client', () => {
	let shared = false;
	let joined: FakeRoom | null = null;
	class Room {
		handlers = new Map<string, (...args: unknown[]) => void>();
		remoteParticipants = new Map();
		localParticipant = {
			identity: 'me',
			async setScreenShareEnabled(on: boolean) {
				shared = on;
			},
			getTrackPublication: () => (shared ? { videoTrack: {} } : undefined),
			async publishTrack() {},
			unpublishTrack() {},
		};
		on(event: string, handler: (...args: unknown[]) => void) {
			this.handlers.set(event, handler);
			return this;
		}
		async connect() {
			joined = this as FakeRoom;
		}
		disconnect() {}
	}
	return {
		Room,
		// The rider hitting Chrome's own "Stop sharing" bar: LiveKit ends the
		// track, unpublishes it itself, and the event is the only word we get.
		stopSharingNatively() {
			shared = false;
			joined?.handlers.get('LocalTrackUnpublished')?.({
				source: 'screen_share',
			});
		},
		// The server closing the connection under us: the SDK gives up and
		// says so once, with nothing else attached.
		dropNatively() {
			joined?.handlers.get('Disconnected')?.();
		},
		// Every RoomEvent.X is just its own name to the wiring under test.
		RoomEvent: new Proxy({}, { get: (_, key) => key }),
		Track: {
			Source: {
				Microphone: 'microphone',
				Camera: 'camera',
				ScreenShare: 'screen_share',
			},
			Kind: { Audio: 'audio', Video: 'video' },
		},
	};
});

interface FakeRoom {
	handlers: Map<string, (...args: unknown[]) => void>;
}

// The mic chain wants a real AudioContext; the meter is the one piece of it
// with a worker behind it, so it is the one piece that has to be faked.
vi.mock('$lib/room/mic-level', () => ({
	createMicMeter: async () => ({ out: { connect() {} }, stop() {} }),
}));

const { createRoomAv } = await import('./av.svelte');
const { stopSharingNatively, dropNatively } =
	(await import('livekit-client')) as unknown as {
		stopSharingNatively: () => void;
		dropNatively: () => void;
	};

/** Enough of Web Audio and getUserMedia for `openMic` to succeed. */
function withMicHardware<T>(
	run: () => Promise<T>,
	devices: MediaDeviceInfo[] = [],
): Promise<T> {
	class FakeAudioContext {
		currentTime = 0;
		createMediaStreamSource() {
			return {};
		}
		createGain() {
			return { gain: { value: 0, setTargetAtTime() {} }, connect() {} };
		}
		createMediaStreamDestination() {
			return { stream: { getAudioTracks: () => [{ stop() {} }] } };
		}
		async close() {}
	}
	vi.stubGlobal('AudioContext', FakeAudioContext);
	const had = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
	Object.defineProperty(navigator, 'mediaDevices', {
		configurable: true,
		value: {
			getUserMedia: async () => ({ getTracks: () => [] }),
			enumerateDevices: async () => devices,
			addEventListener() {},
			removeEventListener() {},
		},
	});
	return run().finally(() => {
		vi.unstubAllGlobals();
		if (had) Object.defineProperty(navigator, 'mediaDevices', had);
		else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
	});
}

describe('createRoomAv', () => {
	// #173: the connection outlives the page that opened it. A $derived built
	// here would belong to that page's effect and freeze at its last value the
	// moment you navigate away — which is how screenshares stopped reaching
	// the stage after #284.
	it('still sees a new share after its creating effect is destroyed', async () => {
		let av!: ReturnType<typeof createRoomAv>;
		const dispose = $effect.root(() => {
			av = createRoomAv('mfw');
		});
		// The room page resolves the pick; av only has to keep offering it.
		const onStage = () => pickStage(av.stageSources, av.stagePick);
		expect(onStage()).toBe(null);
		await av.join();

		dispose();

		await av.toggleShare();
		expect(onStage()?.key).toBe('screen:me');
		expect(av.stageSources.map((s) => s.key)).toEqual(['screen:me']);
	});

	// #354: the browser's own bar ends the share without asking us. LiveKit
	// unpublishes the track and says so only through LocalTrackUnpublished —
	// unheard, the button went on offering to stop a share already over, and
	// the sharer's stage sat on its last frame.
	it('follows the browser when it ends a share behind our back', async () => {
		let av!: ReturnType<typeof createRoomAv>;
		const dispose = $effect.root(() => {
			av = createRoomAv('mfw');
		});
		await av.join();
		await av.toggleShare();
		expect(av.sharing).toBe(true);

		stopSharingNatively();

		expect(av.sharing).toBe(false);
		expect(av.stageSources).toEqual([]);
		dispose();
	});

	// #641: LiveKit dropping the connection gets one automatic rejoin, and it
	// used to call join() bare — the SPEC default of an open mic — after the
	// Disconnected handler had already cleared micOn. A rider who muted for a
	// phone call came back publishing, with nothing to announce it. The drop
	// is a resume, like the #480 refresh: it keeps what the rider had.
	describe.each([
		{ what: 'a rider who was talking comes back talking', mute: false },
		{ what: 'a rider who muted comes back muted', mute: true },
	])('what the drop-rejoin is told about the mic', ({ what, mute }) => {
		it(what, async () => {
			await withMicHardware(async () => {
				let av!: ReturnType<typeof createRoomAv>;
				const dispose = $effect.root(() => {
					av = createRoomAv('mfw');
				});
				await av.join();
				expect(av.micOn).toBe(true);
				if (mute) await av.toggleMic();
				expect(av.micOn).toBe(!mute);

				dropNatively();

				expect(av.dropped).toBe(1);
				expect(av.micOn).toBe(false);
				expect(av.micBeforeDrop).toBe(!mute);
				dispose();
			});
		});
	});

	it('rejoins listening only when the mic never opened', async () => {
		let av!: ReturnType<typeof createRoomAv>;
		const dispose = $effect.root(() => {
			av = createRoomAv('mfw');
		});
		// No audio hardware here: the join downgrades to listen-only.
		await av.join();
		expect(av.micOn).toBe(false);

		dropNatively();

		expect(av.micBeforeDrop).toBe(false);
		dispose();
	});

	// #658: the pickers used to fill only after the first connect, so a rider
	// joined with the wrong mic to be allowed to choose the right one. The mic
	// test is the earliest grant there is — the names arrive with it.
	it('lists your microphones the moment the mic test is granted', async () => {
		const yeti = {
			deviceId: 'yeti',
			kind: 'audioinput',
			label: 'Yeti Stereo Microphone',
			groupId: 'g1',
		} as MediaDeviceInfo;
		await withMicHardware(async () => {
			let av!: ReturnType<typeof createRoomAv>;
			const dispose = $effect.root(() => {
				av = createRoomAv('mfw');
			});
			expect(av.mics).toEqual([]);

			await av.toggleMicTest();

			expect(av.micTesting).toBe(true);
			await vi.waitFor(() =>
				expect(av.mics.map((m) => m.label)).toEqual(['Yeti Stereo Microphone']),
			);
			await av.toggleMicTest();
			dispose();
		}, [yeti]);
	});

	describe.each([
		{ what: 'no mediaDevices at all', mediaDevices: undefined },
		{
			what: 'enumerateDevices refuses',
			mediaDevices: {
				enumerateDevices: async () => {
					throw new DOMException('denied', 'NotAllowedError');
				},
				addEventListener() {},
				removeEventListener() {},
			},
		},
	])('refreshing devices with $what', ({ mediaDevices }) => {
		it('leaves an empty list instead of throwing into the panel', async () => {
			const had = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: mediaDevices,
			});
			try {
				let av!: ReturnType<typeof createRoomAv>;
				const dispose = $effect.root(() => {
					av = createRoomAv('mfw');
				});
				await expect(av.refreshDevices()).resolves.toBeUndefined();
				expect(av.mics).toEqual([]);
				dispose();
			} finally {
				if (had) Object.defineProperty(navigator, 'mediaDevices', had);
				else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
			}
		});
	});

	// #289: the rail draws the threshold as a mark on the mic meter. While
	// music plays the gate SPEC-doubles, so a mark drawn from the stored
	// value would sit below the level actually holding the rider closed —
	// the display would lie exactly when the rider is wondering why.
	//
	// #478: and the doubling itself has two edges. It buys back speaker
	// bleed, so a rider who hears no music must not pay for it; and doubled
	// is +6 dB, which leaves the axis from a gate the slider can reach —
	// off-axis, the mark pins at 100% and the mic may never open again.
	describe.each([
		{
			what: 'leaves the gate alone with the deck stopped',
			set: 0.02,
			deck: false,
			music: 70,
			want: 0.02,
		},
		{
			what: 'doubles it while the deck plays',
			set: 0.02,
			deck: true,
			music: 70,
			want: 0.04,
		},
		{
			what: 'leaves it alone for a rider whose music is at zero',
			set: 0.02,
			deck: true,
			music: 0,
			want: 0.02,
		},
		{
			what: 'keeps a near-ceiling gate on the axis',
			set: GATE_CEIL * 0.75,
			deck: true,
			music: 70,
			want: GATE_CEIL,
		},
	])('effective gate threshold', ({ what, set, deck, music, want }) => {
		it(what, () => {
			const dispose = $effect.root(() => {
				mixer.setMusic(music);
				const av = createRoomAv('mfw');
				av.setGateThreshold(set);
				av.setDeckPlaying(deck);

				expect(av.gateThreshold).toBeCloseTo(set, 10);
				expect(av.effectiveGateThreshold).toBeCloseTo(want, 10);
				// Off the axis, the meter's mark stops being the gate.
				expect(av.effectiveGateThreshold).toBeLessThanOrEqual(GATE_CEIL);
				expect(av.effectiveGateThreshold).toBeGreaterThanOrEqual(GATE_FLOOR);
			});
			dispose();
			mixer.setMusic(70);
		});
	});

	it('clamps a threshold to somewhere the meter can draw it', () => {
		const dispose = $effect.root(() => {
			const av = createRoomAv('mfw');
			av.setGateThreshold(0);
			expect(av.gateThreshold).toBe(GATE_FLOOR);
			av.setGateThreshold(1);
			expect(av.gateThreshold).toBe(GATE_CEIL);
		});
		dispose();
	});
});
