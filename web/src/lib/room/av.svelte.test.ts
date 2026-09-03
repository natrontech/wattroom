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

const { createRoomAv } = await import('./av.svelte');
const { stopSharingNatively } = (await import('livekit-client')) as unknown as {
	stopSharingNatively: () => void;
};

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
