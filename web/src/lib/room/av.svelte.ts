import {
	LocalVideoTrack,
	RemoteTrack,
	Room,
	RoomEvent,
	Track,
} from 'livekit-client';
import { api } from '$lib/api';
import { mixer } from '$lib/sound/mixer.svelte';
import { mountTrack } from '$lib/room/mount-track';

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
	/** Rider ids with a live camera track — bumped to retrigger attach. */
	let videoOf = $state<Record<string, number>>({});
	/** The one shared screen (#206): last share wins, like a projector. */
	let screenOf = $state<{ id: string; key: number } | null>(null);
	let speaking = $state<Record<string, boolean>>({});
	/** Bumped when LiveKit drops us while live — the connection auto-rejoins
	 * once with a fresh token (#219: 6h expiry, transient drops). */
	let dropped = $state(0);
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
		if (mic) closeMic(); // a mic test or stale chain must not orphan a stream
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

	let lastTick = 0;
	function runGate() {
		if (!mic || (!micOn && !testing)) return;
		if (mode === 'ptt') {
			setGate(pttHeld);
			return;
		}
		const threshold = musicPlaying ? gateThreshold * 2 : gateThreshold;
		const now = performance.now();
		// Hidden tabs clamp timers to ~1 s (#214): with a fixed 800 ms hold the
		// gate chopped speech at 1 Hz in the background. Hold at least two real
		// intervals, whatever the browser is actually giving us.
		const dt = lastTick > 0 ? now - lastTick : 120;
		lastTick = now;
		const hold = Math.max(800, 2.5 * dt);
		if (micLevel >= threshold) {
			lastLoud = now;
			if (!transmitting) setGate(true);
		} else if (transmitting && now - lastLoud > hold) {
			setGate(false);
		}
	}

	/** Mic test (#178): hear yourself through the gate before anyone else
	 * does. Same chain as transmission, output to the local speakers; the
	 * meter and the transmitting verdict run identically. Only outside a
	 * live mic — in voice, the meter is already the truth. */
	let testing = $state(false);
	async function startMicTest() {
		if (mic || testing) return;
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
		gain.gain.value = 0;
		source.connect(analyser);
		source.connect(gain);
		gain.connect(ctx.destination); // your own ears, not the room
		const dest = ctx.createMediaStreamDestination();
		mic = { ctx, raw, gain, analyser, track: dest.stream.getAudioTracks()[0] };
		testing = true;
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

	function stopMicTest() {
		if (!testing) return;
		testing = false;
		closeMic();
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
		testing = false;
	}

	function setVoice(id: string, state: 'live' | 'muted' | null) {
		const next = { ...voice };
		if (state === null) delete next[id];
		else next[id] = state;
		voice = next;
	}

	let room: Room | null = null;
	const videoTracks = new Map<string, RemoteTrack | LocalVideoTrack>();
	const screenTracks = new Map<string, RemoteTrack | LocalVideoTrack>();
	const audioElements = new Map<string, HTMLAudioElement>();
	// Per-rider output gain (#179): media-element → gain → speakers, so a
	// quiet teammate can go ABOVE unity — element.volume caps at 1, WebAudio
	// doesn't.
	let outCtx: AudioContext | null = null;
	let riderBus: DynamicsCompressorNode | null = null;
	const riderGains = new Map<string, GainNode>();
	const riderSources = new Map<string, MediaElementAudioSourceNode>();

	function routeRiderAudio(identity: string, el: HTMLAudioElement) {
		try {
			outCtx ??= new AudioContext();
			// One limiter for all rider audio (#152): faders go to ×2, and two
			// boosted voices summing past 1.0 would hard-clip at the DAC.
			if (!riderBus) {
				riderBus = outCtx.createDynamicsCompressor();
				riderBus.threshold.value = -6;
				riderBus.knee.value = 4;
				riderBus.ratio.value = 12;
				riderBus.attack.value = 0.003;
				riderBus.release.value = 0.25;
				riderBus.connect(outCtx.destination);
			}
			const source = outCtx.createMediaElementSource(el);
			const gain = outCtx.createGain();
			gain.gain.value = mixer.riderGain(identity);
			source.connect(gain);
			gain.connect(riderBus);
			riderGains.set(identity, gain);
			riderSources.set(identity, source);
		} catch {
			// routing failed: the element still plays at unity — degraded, not broken
		}
	}

	function onVisible() {
		if (document.visibilityState !== 'visible') return;
		// Browsers may suspend audio graphs in long-hidden tabs; coming
		// back must not need a rejoin (#214).
		if (mic && mic.ctx.state === 'suspended') void mic.ctx.resume();
		if (outCtx?.state === 'suspended') void outCtx.resume();
	}
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisible);
	}

	function bumpVideo(id: string) {
		videoOf = { ...videoOf, [id]: (videoOf[id] ?? 0) + 1 };
	}

	// A camera turning OFF must clear the flag — bumping it left a blank
	// tile claiming "camera on" for the rest of the session (audit #219).
	function dropVideo(id: string) {
		const next = { ...videoOf };
		delete next[id];
		videoOf = next;
	}

	async function join() {
		// Double-click or an impatient rail tap must not build a second
		// participant with the same identity (audit #219).
		if (status === 'connecting' || status === 'live') return;
		void room?.disconnect();
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
		r.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
			if (track.kind === Track.Kind.Video) {
				if (pub.source === Track.Source.ScreenShare) {
					screenTracks.set(participant.identity, track);
					screenOf = {
						id: participant.identity,
						key: (screenOf?.key ?? 0) + 1,
					};
				} else {
					videoTracks.set(participant.identity, track);
					bumpVideo(participant.identity);
				}
			}
			if (track.kind === Track.Kind.Audio) {
				const el = track.attach() as HTMLAudioElement;
				audioElements.set(participant.identity, el);
				document.body.appendChild(el);
				routeRiderAudio(participant.identity, el);
			}
		});
		r.on(RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
			if (track.kind === Track.Kind.Video) {
				if (pub.source === Track.Source.ScreenShare) {
					screenTracks.delete(participant.identity);
					if (screenOf?.id === participant.identity) {
						// Fall back to any remaining share — a teammate stopping
						// theirs must not blank YOURS (audit #219).
						const next = [...screenTracks.keys()][0];
						screenOf = next
							? { id: next, key: (screenOf?.key ?? 0) + 1 }
							: null;
					}
				} else {
					videoTracks.delete(participant.identity);
					dropVideo(participant.identity);
				}
			}
			if (track.kind === Track.Kind.Audio) {
				track.detach().forEach((el) => el.remove());
				audioElements.delete(participant.identity);
				riderGains.get(participant.identity)?.disconnect();
				riderGains.delete(participant.identity);
				riderSources.get(participant.identity)?.disconnect();
				riderSources.delete(participant.identity);
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
			const unexpected = status === 'live';
			for (const el of audioElements.values()) el.remove();
			audioElements.clear();
			videoTracks.clear();
			videoOf = {};
			screenTracks.clear();
			screenOf = null;
			voice = {};
			// Nobody is talking to a room you are no longer in — a stale
			// speaking flag parked music and cues at duck level forever, and
			// camOn/sharing lied about dead tracks (audit #219).
			speaking = {};
			camOn = false;
			sharing = false;
			room = null;
			closeMic();
			if (status === 'live') status = 'off';
			if (unexpected) dropped += 1;
		});
	}

	return {
		get dropped() {
			return dropped;
		},
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
		get micTesting() {
			return testing;
		},
		async toggleMicTest() {
			if (testing) stopMicTest();
			else
				await startMicTest().catch(() => {
					testing = false;
				});
		},
		setPtt(held: boolean) {
			pttHeld = held;
			runGate();
		},
		/** SPEC: while the jukebox plays the gate threshold doubles. */
		setMusicPlaying(playing: boolean) {
			musicPlaying = playing;
		},
		/** Applies the mixer's per-rider gain live (#179). */
		setRiderGain(id: string, v: number) {
			mixer.setRiderGain(id, v);
			const gain = riderGains.get(id);
			if (gain) gain.gain.value = mixer.riderGain(id);
		},
		join,
		async toggleMic() {
			if (!room) return;
			if (testing) stopMicTest();
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
				if (camOn && track) {
					videoTracks.set(id, track);
					bumpVideo(id);
				} else {
					videoTracks.delete(id);
					dropVideo(id);
				}
			} catch {
				camOn = false;
			}
		},
		async toggleShare() {
			if (!room) return;
			sharing = !sharing;
			try {
				// The browser's picker can be cancelled — trust the publication,
				// not our intent.
				await room.localParticipant.setScreenShareEnabled(sharing);
				const track = room.localParticipant.getTrackPublication(
					Track.Source.ScreenShare,
				)?.videoTrack;
				const id = room.localParticipant.identity;
				if (sharing && track) {
					screenTracks.set(id, track);
					screenOf = { id, key: (screenOf?.key ?? 0) + 1 };
				} else {
					sharing = false;
					screenTracks.delete(id);
					if (screenOf?.id === id) screenOf = null;
				}
			} catch {
				sharing = false;
			}
		},
		/** Attach a rider's video into a container; called from the tile. */
		get screenOf() {
			return screenOf;
		},
		/** The projector surface — contain, not cover: a screen is a document. */
		attachScreen(container: HTMLElement) {
			mountTrack(
				container,
				screenOf ? screenTracks.get(screenOf.id) : undefined,
				'contain',
			);
		},
		attach(riderId: string, container: HTMLElement) {
			mountTrack(container, videoTracks.get(riderId), 'cover');
		},
		leave() {
			closeMic();
			void room?.disconnect();
			room = null;
			status = 'off';
			micOn = camOn = sharing = false;
			voice = {};
			speaking = {};
			// This av instance dies with the connection: audio graph and
			// listener go with it, or six room-hops exhaust the browser's
			// AudioContext budget (audit #219).
			if (typeof document !== 'undefined')
				document.removeEventListener('visibilitychange', onVisible);
			for (const gain of riderGains.values()) gain.disconnect();
			for (const source of riderSources.values()) source.disconnect();
			riderGains.clear();
			riderSources.clear();
			void outCtx?.close().catch(() => {});
			outCtx = null;
			riderBus = null;
		},
	};
}
