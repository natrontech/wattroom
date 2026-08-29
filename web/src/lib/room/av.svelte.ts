import {
	LocalVideoTrack,
	RemoteTrack,
	Room,
	RoomEvent,
	Track,
} from 'livekit-client';
import { api } from '$lib/api';

/**
 * The room's call (#21): LiveKit voice + camera + screenshare, joined with a
 * token the server mints against the same membership check as the metrics
 * socket. AV is transit-only and never recorded (locked privacy decision) —
 * nothing here persists anything.
 *
 * Mic starts on with browser noiseSuppression + echoCancellation (SPEC room
 * audio defaults); camera starts off. Track ownership: LiveKit owns the media
 * elements' streams, this store owns attachment points keyed by rider id so
 * the dashboard can put faces on the tiles it already has.
 */
export type AvStatus = 'off' | 'connecting' | 'live' | 'failed';

export function createRoomAv(slug: string) {
	let status = $state<AvStatus>('off');
	let micOn = $state(false);
	let camOn = $state(false);
	let sharing = $state(false);
	let error = $state<string | null>(null);
	/** Rider ids with a live camera/screen track — bumped to retrigger attach. */
	let videoOf = $state<Record<string, number>>({});
	let speaking = $state<Record<string, boolean>>({});

	let room: Room | null = null;
	const videoTracks = new Map<string, RemoteTrack | LocalVideoTrack>();
	const audioElements = new Map<string, HTMLAudioElement>();

	function bumpVideo(id: string) {
		videoOf = { ...videoOf, [id]: (videoOf[id] ?? 0) + 1 };
	}

	async function join() {
		status = 'connecting';
		error = null;
		const res = await api<{ url: string; token: string }>(
			`/api/rooms/${slug}/av-token`,
		);
		if (!res.ok) {
			status = 'failed';
			error = res.error.message;
			return;
		}
		try {
			room = new Room({
				audioCaptureDefaults: {
					noiseSuppression: true,
					echoCancellation: true,
				},
			});
			wire(room);
			await room.connect(res.data.url, res.data.token);
			status = 'live';
			// Mic on by default (SPEC); a denied permission downgrades to
			// listen-only rather than failing the join.
			try {
				await room.localParticipant.setMicrophoneEnabled(true);
				micOn = true;
			} catch {
				micOn = false;
			}
		} catch (cause) {
			status = 'failed';
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function wire(r: Room) {
		r.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
			if (track.kind === Track.Kind.Video) {
				videoTracks.set(participant.identity, track);
				bumpVideo(participant.identity);
			}
			if (track.kind === Track.Kind.Audio) {
				const el = track.attach() as HTMLAudioElement;
				audioElements.set(participant.identity, el);
				document.body.appendChild(el);
			}
		});
		r.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
			if (track.kind === Track.Kind.Video) {
				videoTracks.delete(participant.identity);
				bumpVideo(participant.identity);
			}
			if (track.kind === Track.Kind.Audio) {
				track.detach().forEach((el) => el.remove());
				audioElements.delete(participant.identity);
			}
		});
		r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
			const next: Record<string, boolean> = {};
			for (const p of speakers) next[p.identity] = true;
			speaking = next;
		});
		r.on(RoomEvent.Disconnected, () => {
			for (const el of audioElements.values()) el.remove();
			audioElements.clear();
			videoTracks.clear();
			videoOf = {};
			if (status === 'live') status = 'off';
		});
	}

	return {
		get status() {
			return status;
		},
		get micOn() {
			return micOn;
		},
		get camOn() {
			return camOn;
		},
		get sharing() {
			return sharing;
		},
		get error() {
			return error;
		},
		get videoOf() {
			return videoOf;
		},
		get speaking() {
			return speaking;
		},
		join,
		async toggleMic() {
			if (!room) return;
			micOn = !micOn;
			await room.localParticipant.setMicrophoneEnabled(micOn).catch(() => {
				micOn = false;
			});
		},
		async toggleCam() {
			if (!room) return;
			camOn = !camOn;
			try {
				await room.localParticipant.setCameraEnabled(camOn);
				const track = room.localParticipant.getTrackPublication(
					Track.Source.Camera,
				)?.videoTrack;
				const id = room.localParticipant.identity;
				if (camOn && track) videoTracks.set(id, track);
				else videoTracks.delete(id);
				bumpVideo(id);
			} catch {
				camOn = false;
			}
		},
		async toggleShare() {
			if (!room) return;
			sharing = !sharing;
			try {
				await room.localParticipant.setScreenShareEnabled(sharing);
				const track = room.localParticipant.getTrackPublication(
					Track.Source.ScreenShare,
				)?.videoTrack;
				const id = room.localParticipant.identity;
				if (sharing && track) videoTracks.set(id, track);
				else if (!camOn) videoTracks.delete(id);
				bumpVideo(id);
			} catch {
				sharing = false;
			}
		},
		/** Attach a rider's video into a container; called from the tile. */
		attach(riderId: string, container: HTMLElement) {
			const track = videoTracks.get(riderId);
			container.replaceChildren();
			if (!track) return;
			const el = track.attach();
			el.style.width = '100%';
			el.style.height = '100%';
			el.style.objectFit = 'cover';
			container.appendChild(el);
		},
		leave() {
			void room?.disconnect();
			room = null;
			status = 'off';
			micOn = camOn = sharing = false;
		},
	};
}
