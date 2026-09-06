// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { GATE_CEIL, GATE_FLOOR } from './gate-scale';
import { mixer } from '$lib/sound/mixer.svelte';
import { pickStage } from '$lib/room/stage';
import { observeServerTime, resetServerClock } from '$lib/room/server-clock';

vi.mock('$lib/api', () => ({
	api: vi.fn(async () => ({
		ok: true,
		data: { url: 'ws://livekit', token: 't' },
	})),
}));

vi.mock('livekit-client', () => {
	let shared = false;
	let joined: FakeRoom | null = null;
	const published: Uint8Array[] = [];
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
			async publishData(payload: Uint8Array) {
				published.push(payload);
			},
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
		/**
		 * A remote rider's camera, driven the way LiveKit drives it: switching
		 * one off MUTES the publication (only a screenshare is unpublished), so
		 * the subscription and its track stay exactly where they were.
		 */
		remoteCamera(identity: string, muted = false) {
			const pub = { kind: 'video', source: 'camera', isMuted: muted };
			const participant = { identity };
			joined?.handlers.get('TrackSubscribed')?.(
				{ kind: 'video' },
				pub,
				participant,
			);
			return {
				mute() {
					pub.isMuted = true;
					joined?.handlers.get('TrackMuted')?.(pub, participant);
				},
				unmute() {
					pub.isMuted = false;
					joined?.handlers.get('TrackUnmuted')?.(pub, participant);
				},
			};
		},
		/** A remote rider's microphone arriving: an audio track to attach. */
		remoteVoice(identity: string) {
			joined?.handlers.get('TrackSubscribed')?.(
				{
					kind: 'audio',
					attach: () => document.createElement('audio'),
					detach: () => [],
				},
				{ kind: 'audio', source: 'microphone', isMuted: false },
				{ identity },
			);
		},
		/** Every data packet this tab has broadcast, decoded. */
		broadcasts() {
			return published.map((p) => JSON.parse(new TextDecoder().decode(p)));
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
const { api } = await import('$lib/api');
const {
	stopSharingNatively,
	dropNatively,
	broadcasts,
	remoteCamera,
	remoteVoice,
} = (await import('livekit-client')) as unknown as {
	stopSharingNatively: () => void;
	dropNatively: () => void;
	broadcasts: () => { t: string; at: number }[];
	remoteCamera: (
		identity: string,
		muted?: boolean,
	) => { mute: () => void; unmute: () => void };
	remoteVoice: (identity: string) => void;
};

/** Every fader on the output side, in the order the graph built them. */
type FakeGain = { gain: { value: number } };
function withOutputGraph<T>(
	run: (gains: FakeGain[]) => Promise<T>,
): Promise<T> {
	const gains: FakeGain[] = [];
	class FakeAudioContext {
		currentTime = 0;
		destination = {};
		createDynamicsCompressor() {
			return {
				threshold: {},
				knee: {},
				ratio: {},
				attack: {},
				release: {},
				connect() {},
			};
		}
		createMediaElementSource() {
			return { connect() {}, disconnect() {} };
		}
		createGain() {
			const node = {
				gain: {
					value: 1,
					setTargetAtTime(target: number) {
						node.gain.value = target;
					},
				},
				connect() {},
				disconnect() {},
			};
			gains.push(node);
			return node;
		}
		async close() {}
	}
	vi.stubGlobal('AudioContext', FakeAudioContext);
	// `finally` on the promise, not a `try` around it: a `try/finally` here
	// unstubs the moment the async body first awaits.
	return run(gains).finally(() => vi.unstubAllGlobals());
}

/** The machine's side of the mic: what a test can do to the hardware. */
interface MicHardware {
	/** The device goes away under a live capture — USB out, BT to HFP. */
	unplug(): void;
	/** What enumerateDevices reports next, then the browser says it changed. */
	plugIn(devices: Partial<MediaDeviceInfo>[]): Promise<void>;
}

/** Enough of Web Audio and getUserMedia for `openMic` to succeed — or, given
 *  `refuse`, for the browser to turn the mic down the way a denied permission
 *  does. `initialDevices` is what enumerateDevices names until `plugIn`. */
function withMicHardware<T>(
	run: (hw: MicHardware) => Promise<T>,
	initialDevices: Partial<MediaDeviceInfo>[] = [],
	refuse?: Error,
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
	// The capture track is an EventTarget so `ended` can arrive the way the
	// browser sends it; stop() stays silent, as the real one does.
	class FakeCapture extends EventTarget {
		stop() {}
	}
	let capture: FakeCapture | null = null;
	let devices = initialDevices;
	const listeners = new Map<string, () => unknown>();
	const had = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
	Object.defineProperty(navigator, 'mediaDevices', {
		configurable: true,
		value: {
			getUserMedia: async () => {
				if (refuse) throw refuse;
				capture = new FakeCapture();
				return {
					getTracks: () => [capture],
					getAudioTracks: () => [capture],
				};
			},
			enumerateDevices: async () => devices,
			addEventListener(type: string, fn: () => unknown) {
				listeners.set(type, fn);
			},
			removeEventListener(type: string) {
				listeners.delete(type);
			},
		},
	});
	const hw: MicHardware = {
		unplug() {
			capture?.dispatchEvent(new Event('ended'));
		},
		async plugIn(next) {
			devices = next;
			await listeners.get('devicechange')?.();
		},
	};
	return run(hw).finally(() => {
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

	// #875: away closed the mic and the camera and left the room playing at
	// full volume into an empty chair — the rider's own speakers still
	// carrying voices, the jukebox and every cue.
	it('takes the room off the speakers while the rider is away', async () => {
		await withOutputGraph(async (gains) => {
			let av!: ReturnType<typeof createRoomAv>;
			const dispose = $effect.root(() => {
				av = createRoomAv('mfw');
			});
			await av.join();
			remoteVoice('jan');
			expect(gains.at(-1)?.gain.value).toBe(1);

			await av.setAway(true);
			expect(mixer.muted).toBe(true);
			expect(gains.map((g) => g.gain.value)).toEqual([0]);
			// A rider who joins voice while you are out arrives silent too.
			remoteVoice('mia');
			expect(gains.map((g) => g.gain.value)).toEqual([0, 0]);

			await av.setAway(false);
			expect(gains.map((g) => g.gain.value)).toEqual([1, 1]);

			// The room is behind you: leaving hands the speakers back.
			await av.setAway(true);
			av.leave();
			expect(mixer.muted).toBe(false);
			dispose();
		});
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

	// #851: a rider report — a colleague switched his camera off and his tile
	// went blank, no mark on it. livekit-client MUTES a camera on disable
	// rather than unpublishing it, so TrackUnsubscribed never came, the seat
	// went on claiming "camera on", and the tile drew an attached element with
	// no frames in it where the mark belongs.
	it('gives the seat back when a remote camera is switched off', async () => {
		let av!: ReturnType<typeof createRoomAv>;
		const dispose = $effect.root(() => {
			av = createRoomAv('mfw');
		});
		await av.join();
		const cam = remoteCamera('jan');
		expect(av.videoOf.jan).toBeTruthy();

		cam.mute();

		expect(av.videoOf.jan).toBeUndefined();
		expect(av.stageSources).toEqual([]);
		dispose();
	});

	// The camera coming back must not need a rejoin — the subscription was
	// never lost, only the picture.
	it('takes the seat back when the camera comes on again', async () => {
		let av!: ReturnType<typeof createRoomAv>;
		const dispose = $effect.root(() => {
			av = createRoomAv('mfw');
		});
		await av.join();
		const cam = remoteCamera('jan');
		cam.mute();

		cam.unmute();

		expect(av.videoOf.jan).toBeTruthy();
		expect(av.stageSources.map((source) => source.key)).toEqual(['cam:jan']);
		dispose();
	});

	// Walking in on a rider whose camera is already off: the publication is
	// there to subscribe to, so the seat used to be claimed on the strength of
	// a track that was never going to paint.
	it('leaves the seat empty for a camera that is already off', async () => {
		let av!: ReturnType<typeof createRoomAv>;
		const dispose = $effect.root(() => {
			av = createRoomAv('mfw');
		});
		await av.join();

		const cam = remoteCamera('jan', true);

		expect(av.videoOf.jan).toBeUndefined();
		cam.unmute();
		expect(av.videoOf.jan).toBeTruthy();
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

	// #642: the store knew why and never said. A denied permission used to
	// leave the rider in voice with a mic drawn muted and nothing to read.
	it('says the browser is blocking the mic when the join lands listen-only', async () => {
		const denied = new Error('Permission denied');
		denied.name = 'NotAllowedError';
		await withMicHardware(
			async () => {
				let av!: ReturnType<typeof createRoomAv>;
				const dispose = $effect.root(() => {
					av = createRoomAv('mfw');
				});
				await av.join();
				expect(av.status).toBe('live');
				expect(av.micOn).toBe(false);
				expect(av.error).toEqual({
					message:
						'Your browser is blocking the microphone — allow it in the address bar and try again.',
					signIn: false,
				});
				dispose();
			},
			[],
			denied,
		);
	});

	// #642: an expired session is the one refusal "Try voice again" cannot
	// fix, so the store marks it for the sidebar to offer the login page.
	it('asks for a sign-in when the token endpoint says the session is over', async () => {
		vi.mocked(api).mockResolvedValueOnce({
			ok: false,
			error: {
				error: 'unauthorized',
				message: 'Your session expired — sign in again to join voice.',
			},
		});
		let av!: ReturnType<typeof createRoomAv>;
		const dispose = $effect.root(() => {
			av = createRoomAv('mfw');
		});
		await av.join();
		expect(av.status).toBe('failed');
		expect(av.error).toEqual({
			message: 'Your session expired — sign in again to join voice.',
			signIn: true,
		});
		dispose();
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

	// #646: a join is stamped by LiveKit's server; the takeover used to be
	// stamped by the browser. yieldsTo compares the two as numbers, so a
	// clock a minute behind made "use this tab instead" read older than the
	// other tab's join, and that tab kept the mic — the rider heard themselves
	// twice. The takeover has to sit on the server's clock too.
	it('stamps a takeover on the server clock, not the browser', async () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(1_000_000);
			// One tick from a server a minute ahead of this machine.
			observeServerTime(1_060_000);
			let av!: ReturnType<typeof createRoomAv>;
			const dispose = $effect.root(() => {
				av = createRoomAv('mfw');
			});
			await av.join();
			await av.takeOver();

			const claim = broadcasts().find((b) => b.t === 'av-claim');
			expect(claim?.at).toBe(1_060_000);
			dispose();
		} finally {
			resetServerClock();
			vi.useRealTimers();
		}
	});

	// #640: we publish our own WebAudio track, so when the capture behind it
	// dies — headset unplugged, Bluetooth to HFP, another app taking the
	// device — LiveKit sees nothing and the destination goes on emitting
	// silence. micOn stayed true and the icon stayed green for the rest of
	// the ride. The capture ending is a fault the rider must be shown, and
	// one button must bring the mic back.
	describe('a microphone that dies mid-ride', () => {
		it('says so, goes muted, and comes back on Reconnect', async () => {
			await withMicHardware(async (hw) => {
				let av!: ReturnType<typeof createRoomAv>;
				const dispose = $effect.root(() => {
					av = createRoomAv('mfw');
				});
				await av.join();
				expect(av.micOn).toBe(true);
				expect(av.voice.me).toBe('live');
				expect(av.micFault).toBe(false);

				hw.unplug();

				expect(av.micFault).toBe(true);
				expect(av.micOn).toBe(false);
				expect(av.voice.me).toBe('muted');

				await av.reconnectMic();

				expect(av.micFault).toBe(false);
				expect(av.micOn).toBe(true);
				expect(av.voice.me).toBe('live');
				dispose();
			});
		});

		it('is not a fault when the rider closed the mic themselves', async () => {
			await withMicHardware(async (hw) => {
				let av!: ReturnType<typeof createRoomAv>;
				const dispose = $effect.root(() => {
					av = createRoomAv('mfw');
				});
				await av.join();
				await av.toggleMic();
				expect(av.micOn).toBe(false);

				// The stopped capture's `ended` must find nobody listening.
				hw.unplug();

				expect(av.micFault).toBe(false);
				dispose();
			});
		});

		it('ends a mic test the same way', async () => {
			await withMicHardware(async (hw) => {
				let av!: ReturnType<typeof createRoomAv>;
				const dispose = $effect.root(() => {
					av = createRoomAv('mfw');
				});
				await av.toggleMicTest();
				expect(av.micTesting).toBe(true);

				hw.unplug();

				expect(av.micTesting).toBe(false);
				expect(av.micFault).toBe(true);
				// Nothing to reconnect to outside voice: the button just clears it.
				await av.reconnectMic();
				expect(av.micFault).toBe(false);
				dispose();
			});
		});

		it('un-chooses a mic that is no longer plugged in', async () => {
			await withMicHardware(async (hw) => {
				let av!: ReturnType<typeof createRoomAv>;
				const dispose = $effect.root(() => {
					av = createRoomAv('mfw');
				});
				await av.setMic('usb-1');

				// Pre-permission the browser blanks every id — not evidence.
				await hw.plugIn([{ kind: 'audioinput', deviceId: '' }]);
				expect(av.micId).toBe('usb-1');
				await hw.plugIn([
					{ kind: 'audioinput', deviceId: 'default' },
					{ kind: 'audioinput', deviceId: 'usb-1' },
				]);
				expect(av.micId).toBe('usb-1');

				await hw.plugIn([{ kind: 'audioinput', deviceId: 'default' }]);

				expect(av.micId).toBe('');
				dispose();
			});
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
