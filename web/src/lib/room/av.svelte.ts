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
	/**
	 * Who is in voice and whether their mic is open (#151): absent = not in
	 * voice at all — three states a tile can tell apart at a glance.
	 */
	let voice = $state<Record<string, 'live' | 'muted'>>({});
	/** Own-mic level 0..1 while transmitting — the "is my mic dead" meter. */
	let micLevel = $state(0);
	/** The gate's verdict this instant: is anything leaving this machine? */
	let transmitting = $state(false);
	/** SPEC room-audio defaults; threshold persisted per device. */
	let mode = $state<'gate' | 'ptt'>('gate');
	let gateThreshold = $state(0.02);
	let pttHeld = $state(false);
	let musicPlaying = false;

	const VOICE_KEY = 'wattroom.voice.v1';
	try {
		const saved = JSON.parse(localStorage.getItem(VOICE_KEY) ?? '{}');
		if (saved.mode === 'ptt') mode = 'ptt';
		if (typeof saved.threshold === 'number' && saved.threshold > 0)
			gateThreshold = Math.min(0.1, saved.threshold);
	} catch {
		// storage blocked: SPEC defaults stand
	}
	function persistVoice() {
		try {
			localStorage.setItem(
				VOICE_KEY,
				JSON.stringify({ mode, threshold: gateThreshold }),
			);
		} catch {
			// per-device convenience only
		}
	}

	/**
	 * The mic path (#151, SPEC room audio): capture (browser DSP on) → gain →
	 * published track. The gate drives the GAIN, never the track's mute — a
	 * muted track broadcasts state, and a gate that flaps everyone's muted
	 * chip per pause in speech is worse than no gate.
	 */
	let mic: {
		ctx: AudioContext;
		raw: MediaStream;
		gain: GainNode;
		analyser: AnalyserNode;
		track: MediaStreamTrack;
	} | null = null;
	let meterTimer: ReturnType<typeof setInterval> | undefined;
	let lastLoud = 0;

	async function openMic() {
		const raw = await navigator.mediaDevices.getUserMedia({
			audio: {
				noiseSuppression: true,
				echoCancellation: true,
				autoGainControl: true,
			},
		});
		const ctx = new AudioContext();
		const source = ctx.createMediaStreamSource(raw);
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 512;
		const gain = ctx.createGain();
		gain.gain.value = 0; // closed until the gate opens
		const dest = ctx.createMediaStreamDestination();
		source.connect(analyser);
		source.connect(gain);
		gain.connect(dest);
		const track = dest.stream.getAudioTracks()[0];
		mic = { ctx, raw, gain, analyser, track };
		await room?.localParticipant.publishTrack(track, {
			source: Track.Source.Microphone,
		});
		const bins = new Uint8Array(analyser.frequencyBinCount);
		meterTimer = setInterval(() => {
			if (!mic) return;
			mic.analyser.getByteTimeDomainData(bins);
			let sum = 0;
			for (const v of bins) {
				const centred = (v - 128) / 128;
				sum += centred * centred;
			}
			micLevel = Math.sqrt(sum / bins.length);
			runGate();
		}, 120);
	}

	function setGate(openNow: boolean) {
		if (!mic) return;
		transmitting = openNow;
		// 5 ms ramps (SPEC): no clicks, no zipper noise.
		mic.gain.gain.setTargetAtTime(openNow ? 1 : 0, mic.ctx.currentTime, 0.005);
	}

	function runGate() {
		if (!mic || !micOn) return;
		if (mode === 'ptt') {
			setGate(pttHeld);
			return;
		}
		const threshold = musicPlaying ? gateThreshold * 2 : gateThreshold;
		const now = performance.now();
		if (micLevel >= threshold) {
			lastLoud = now;
			if (!transmitting) setGate(true);
		} else if (transmitting && now - lastLoud > 800) {
			setGate(false);
		}
	}

	function closeMic() {
		clearInterval(meterTimer);
		if (mic) {
			const { ctx, raw, track } = mic;
			room?.localParticipant.unpublishTrack(track);
			for (const t of raw.getTracks()) t.stop();
			void ctx.close();
		}
		mic = null;
		micLevel = 0;
		transmitting = false;
	}

	function setVoice(id: string, state: 'live' | 'muted' | null) {
		const next = { ...voice };
		if (state === null) delete next[id];
		else next[id] = state;
		voice = next;
	}

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
			for (const p of room.remoteParticipants.values()) {
				const pub = p.getTrackPublication(Track.Source.Microphone);
				setVoice(p.identity, pub && !pub.isMuted ? 'live' : 'muted');
			}
			try {
				await openMic();
				micOn = true;
				setVoice(room.localParticipant.identity, 'live');
			} catch {
				micOn = false;
				setVoice(room.localParticipant.identity, 'muted');
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
		const audioState = (p: {
			identity: string;
			getTrackPublication: (source: Track.Source) => unknown;
		}) => {
			const pub = p.getTrackPublication(Track.Source.Microphone) as
				{ isMuted: boolean } | undefined;
			setVoice(p.identity, pub && !pub.isMuted ? 'live' : 'muted');
		};
		r.on(RoomEvent.ParticipantConnected, (p) => audioState(p));
		r.on(RoomEvent.ParticipantDisconnected, (p) => setVoice(p.identity, null));
		r.on(RoomEvent.TrackMuted, (pub, p) => {
			if (pub.kind === Track.Kind.Audio) setVoice(p.identity, 'muted');
		});
		r.on(RoomEvent.TrackUnmuted, (pub, p) => {
			if (pub.kind === Track.Kind.Audio) setVoice(p.identity, 'live');
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
			voice = {};
			closeMic();
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
		get voice() {
			return voice;
		},
		get micLevel() {
			return micLevel;
		},
		get transmitting() {
			return transmitting;
		},
		get mode() {
			return mode;
		},
		get gateThreshold() {
			return gateThreshold;
		},
		get pttHeld() {
			return pttHeld;
		},
		setMode(next: 'gate' | 'ptt') {
			mode = next;
			persistVoice();
			if (next === 'gate') lastLoud = 0;
			runGate();
		},
		setGateThreshold(next: number) {
			gateThreshold = Math.min(0.1, Math.max(0.005, next));
			persistVoice();
		},
		setPtt(held: boolean) {
			pttHeld = held;
			runGate();
		},
		/** SPEC: while the jukebox plays the gate threshold doubles. */
		setMusicPlaying(playing: boolean) {
			musicPlaying = playing;
		},
		join,
		async toggleMic() {
			if (!room) return;
			if (micOn) {
				closeMic();
				micOn = false;
			} else {
				try {
					await openMic();
					micOn = true;
				} catch {
					micOn = false;
				}
			}
			setVoice(room.localParticipant.identity, micOn ? 'live' : 'muted');
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
			closeMic();
			void room?.disconnect();
			room = null;
			status = 'off';
			micOn = camOn = sharing = false;
			voice = {};
		},
	};
}
