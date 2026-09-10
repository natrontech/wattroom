import type { AvConn, AvState } from '$lib/room/av-state.svelte';
import type { DeviceChoices } from '$lib/room/av-devices.svelte';
import type { Speaking } from '$lib/room/speaking';
import type { MediaDevice } from '$lib/room/media-error';
import { createMicChain } from '$lib/room/mic-chain.svelte';

/**
 * This tab's microphone, wired to this tab's connection (#1698).
 *
 * `mic-chain.svelte.ts` owns the capture, the meter, the gate and the mic
 * test and knows nothing about LiveKit; this is the four functions it needs
 * to reach a connection, plus the controls that are about the device rather
 * than about the room.
 *
 * Deliberately innocent of the claim protocol: `toggleMic` and the fault
 * banner's `reconnectMic` both have to ask which tab holds the mic first, so
 * they live in `av-tabs.ts` with that question. Everything here acts on the
 * mic this tab actually has.
 */
export interface MicHost {
	av: AvState;
	conn: AvConn;
	devices: DeviceChoices;
	/** Who is talking, measured off the voice on its way out (#987). */
	talk: Speaking;
	/** Who is in voice and whether their mic is open (#151). */
	setVoice(id: string, state: 'live' | 'muted' | null): void;
	/** Record a device the browser refused. */
	failedMedia(cause: unknown, device: MediaDevice): void;
}

export type Mic = ReturnType<typeof createMic>;

export function createMic(host: MicHost) {
	const { av, conn, devices, talk, setVoice, failedMedia } = host;

	const chain = createMicChain({
		devices,
		publish: async (track) => {
			const lk = conn.liveKit!;
			await conn.room?.localParticipant.publishTrack(track, {
				source: lk.Track.Source.Microphone,
				// Full-band Opus at 96 kbps, not the SDK's 48 (#1340): the room
				// is asked to sound like a voice in the room, and a rider's
				// uplink has that to spare. No DTX: the gate already sends
				// digital silence, and Opus's comfort-noise transitions over it
				// are what the ear reads as "noise reduction".
				audioPreset: lk.AudioPresets.musicHighQuality,
				dtx: false,
			});
		},
		unpublish: (track) => conn.room?.localParticipant.unpublishTrack(track),
		live: () => av.micOn,
		heard: (level) => {
			if (talk.level(conn.myIdentity, level, performance.now()))
				av.speaking = { ...talk.riders };
		},
		silenced: () => {
			if (talk.drop(conn.myIdentity)) av.speaking = { ...talk.riders };
		},
		captureLost: () => {
			av.micOn = false;
			if (conn.room) setVoice(conn.me, 'muted');
		},
	});

	/**
	 * Open the mic and let `micOn` say what actually happened: a device the
	 * browser refuses downgrades to listening rather than failing the caller.
	 */
	async function tryOpen() {
		try {
			await chain.open();
			av.micOn = true;
			// A mic that opens clears the last refusal (#642): the sidebar must
			// not keep explaining a failure that has since been fixed.
			av.error = null;
		} catch (cause) {
			av.micOn = false;
			failedMedia(cause, 'microphone');
		}
	}

	/** Restart the mic test, saying why if the new device refuses (#824). */
	async function restartTest() {
		await chain.startTest().catch((cause) => {
			chain.stopTest();
			failedMedia(cause, 'microphone');
		});
	}

	return {
		chain,
		tryOpen,
		/** Switching mid-transmission rebuilds the capture chain in place. */
		async setDevice(id: string) {
			devices.setMic(id);
			if (chain.testing) {
				chain.stopTest();
				await restartTest();
			} else if (av.micOn) {
				try {
					await chain.open();
				} catch (cause) {
					// Dropped to muted — and told why, the way a join is (#824).
					av.micOn = false;
					setVoice(conn.me, 'muted');
					failedMedia(cause, 'microphone');
				}
			}
		},
		async toggleTest() {
			if (chain.testing) chain.stopTest();
			else await restartTest();
		},
		setMode(next: 'gate' | 'ptt') {
			chain.setMode(next);
		},
		setThreshold(next: number) {
			// Tuning mid-sentence must land on this breath, not the next tick.
			chain.setThreshold(next);
		},
		setPtt(held: boolean) {
			chain.setPttHeld(held);
		},
		/**
		 * The room's deck, as the tick reports it. Whether it raises this
		 * rider's gate is effectiveThreshold's call — their own music level
		 * decides whether there is any bleed to gate out (#478).
		 */
		setDeckPlaying(playing: boolean) {
			chain.setDeckPlaying(playing);
		},
	};
}
