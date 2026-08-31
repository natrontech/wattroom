// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api', () => ({
	api: async () => ({ ok: true, data: { url: 'ws://livekit', token: 't' } }),
}));

vi.mock('livekit-client', () => {
	let shared = false;
	class Room {
		remoteParticipants = new Map();
		localParticipant = {
			identity: 'me',
			async setScreenShareEnabled(on: boolean) {
				shared = on;
			},
			getTrackPublication: () => (shared ? { videoTrack: {} } : undefined),
			unpublishTrack() {},
		};
		on() {
			return this;
		}
		async connect() {}
		disconnect() {}
	}
	return {
		Room,
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

const { createRoomAv } = await import('./av.svelte');

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
		expect(av.stage).toBe(null);
		await av.join();

		dispose();

		await av.toggleShare();
		expect(av.stage?.key).toBe('screen:me');
		expect(av.stageSources.map((s) => s.key)).toEqual(['screen:me']);
	});
});
