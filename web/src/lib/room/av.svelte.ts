import {
	LocalVideoTrack,
	RemoteTrack,
	Room,
	RoomEvent,
	Track,
} from 'livekit-client';
import { api } from '$lib/api';
import { mixer } from '$lib/sound/mixer.svelte';
import { GATE_DEFAULT, clampThreshold } from '$lib/room/gate-scale';
import {
	GATE_ATTACK_MS,
	GATE_RELEASE_MS,
	GATE_SHUT,
	type GateState,
	gateStep,
} from '$lib/room/gate';
import { MIC_CONSTRAINTS } from '$lib/room/capture';
import { type MicMeter, createMicMeter } from '$lib/room/mic-level';
import { mountTrack } from '$lib/room/mount-track';
import {
	type Claim,
	micLiveElsewhere,
	riderOf,
	yieldsTo,
} from '$lib/room/tabs';
import {
	REJOIN_HEARTBEAT_MS,
	clearNote,
	tabId,
	writeNote,
} from '$lib/room/rejoin';

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
export type AvStatus =
	'off' | 'connecting' | 'live' | 'reconnecting' | 'failed';

export function createRoomAv(slug: string) {
	let status = $state<AvStatus>('off');
	let micOn = $state(false);
	let camOn = $state(false);
	// Stepped out (#706). What was live when the rider pressed the button, so
	// coming back restores exactly that and not a default: someone who was
	// listening with the camera off does not return with it on.
	let away = $state(false);
	let micBeforeAway = false;
	let camBeforeAway = false;
	let sharing = $state(false);
	let error = $state<string | null>(null);
	/** Rider ids with a live camera track — bumped to retrigger attach. */
	let videoOf = $state<Record<string, number>>({});
	/**
	 * Every live screenshare (#280). #206's projector kept exactly one — a
	 * second sharer silently stole the room's screen. LiveKit was always fine
	 * with many; only the UI insisted on one, so keep them all in arrival
	 * order (last = newest) and let the viewer choose.
	 */
	let screens = $state<{ id: string; key: number }[]>([]);
	let screenSeq = 0;
	/** What YOU want on the stage: a `screen:`/`cam:` key, or null = newest
	 * share. Yours alone — a stage pick is a glance, never room state. */
	let stagePick = $state<string | null>(null);
	let speaking = $state<Record<string, boolean>>({});
	/** Bumped when LiveKit drops us while live — the connection auto-rejoins
	 * once with a fresh token (#219: 6h expiry, transient drops). */
	let dropped = $state(0);
	/**
	 * Who is in voice and whether their mic is open (#151): absent = not in
	 * voice at all — three states a tile can tell apart at a glance.
	 */
	let voice = $state<Record<string, 'live' | 'muted'>>({});
	/**
	 * This tab gave the mic and camera to another tab of yours (#293). Not an
	 * error and not transient — a persistent status with one button back,
	 * because a rider three metres away must be able to see why they went
	 * quiet without reading a toast that has already gone.
	 */
	let handedOff = $state(false);
	/** Own-mic level 0..1 while transmitting — the "is my mic dead" meter. */
	let micLevel = $state(0);
	/** The gate's verdict this instant: is anything leaving this machine? */
	let transmitting = $state(false);
	/** SPEC room-audio defaults; threshold persisted per device. */
	let mode = $state<'gate' | 'ptt'>('gate');
	let gateThreshold = $state(GATE_DEFAULT);
	let pttHeld = $state(false);
	/** Reactive: the rail draws the EFFECTIVE threshold, and music moves it. */
	let deckPlaying = $state(false);

	const VOICE_KEY = 'wattroom.voice.v1';
	try {
		const saved = JSON.parse(localStorage.getItem(VOICE_KEY) ?? '{}');
		if (saved.mode === 'ptt') mode = 'ptt';
		if (typeof saved.threshold === 'number' && saved.threshold > 0)
			gateThreshold = clampThreshold(saved.threshold);
	} catch {
		// storage blocked: SPEC defaults stand
	}

	// ── Device selection (#181 feedback: "which input/output/camera is this?").
	// '' = browser default. Persisted per device — a chosen mic survives rejoin.
	let micId = $state('');
	let camId = $state('');
	let outId = $state('');
	let deviceList = $state<MediaDeviceInfo[]>([]);
	const DEVICES_KEY = 'wattroom.devices.v1';
	try {
		const saved = JSON.parse(localStorage.getItem(DEVICES_KEY) ?? '{}');
		if (typeof saved.mic === 'string') micId = saved.mic;
		if (typeof saved.cam === 'string') camId = saved.cam;
		if (typeof saved.out === 'string') outId = saved.out;
	} catch {
		// per-device convenience only
	}
	function persistDevices() {
		try {
			localStorage.setItem(
				DEVICES_KEY,
				JSON.stringify({ mic: micId, cam: camId, out: outId }),
			);
		} catch {
			// per-device convenience only
		}
	}
	async function refreshDevices() {
		try {
			deviceList = await navigator.mediaDevices.enumerateDevices();
		} catch {
			deviceList = [];
		}
	}
	// Computed on read, never $derived: a derived created here belongs to
	// whichever component happened to construct the store, and Svelte freezes
	// it at its last value once that component unmounts (derived_inert). The
	// connection outlives every page (#173), so it would freeze on the first
	// navigation away from the room.
	const mics = () => deviceList.filter((d) => d.kind === 'audioinput');
	const cams = () => deviceList.filter((d) => d.kind === 'videoinput');
	const outs = () => deviceList.filter((d) => d.kind === 'audiooutput');
	// Voice output rides the WebAudio bus, so switching speakers needs
	// AudioContext.setSinkId — Chrome has it, and Chrome is the platform
	// (ADR-0004); elsewhere the picker simply doesn't render.
	const canPickOutput =
		typeof AudioContext !== 'undefined' &&
		'setSinkId' in AudioContext.prototype;
	function applySink() {
		if (!outCtx || !outId || !canPickOutput) return;
		void (outCtx as AudioContext & { setSinkId(id: string): Promise<void> })
			.setSinkId(outId)
			.catch(() => {
				// unplugged sink: audio falls back to the OS default, not silence
			});
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
		meter: MicMeter;
		track: MediaStreamTrack;
	} | null = null;
	let gate: GateState = GATE_SHUT;

	/** The capture constraints, honouring the chosen mic; an unplugged choice
	 * falls back to the default instead of failing the join. */
	async function captureMic(): Promise<MediaStream> {
		const base = MIC_CONSTRAINTS;
		if (micId) {
			try {
				return await navigator.mediaDevices.getUserMedia({
					audio: { ...base, deviceId: { exact: micId } },
				});
			} catch {
				micId = '';
				persistDevices();
			}
		}
		return navigator.mediaDevices.getUserMedia({ audio: base });
	}

	/** Every level the audio thread reports: the meter's number and the gate's. */
	function onLevel(level: number) {
		micLevel = level;
		runGate();
	}

	/** capture → level → gate gain. Whoever calls it connects the gain to
	 *  wherever the audio is going: the room, or your own ears. */
	async function buildChain() {
		const raw = await captureMic();
		const ctx = new AudioContext();
		const source = ctx.createMediaStreamSource(raw);
		const gain = ctx.createGain();
		gain.gain.value = 0; // closed until the gate opens
		const meter = await createMicMeter(ctx, source, onLevel);
		meter.out.connect(gain);
		gate = GATE_SHUT;
		return { ctx, raw, gain, meter };
	}

	async function openMic() {
		if (mic) closeMic(); // a mic test or stale chain must not orphan a stream
		const { ctx, raw, gain, meter } = await buildChain();
		const dest = ctx.createMediaStreamDestination();
		gain.connect(dest);
		const track = dest.stream.getAudioTracks()[0];
		mic = { ctx, raw, gain, meter, track };
		await room?.localParticipant.publishTrack(track, {
			source: Track.Source.Microphone,
		});
	}

	function setGate(openNow: boolean) {
		if (!mic) return;
		transmitting = openNow;
		// Up in 5 ms, down over 150 ms (SPEC): opening fast is what keeps the
		// first syllable, and a close that fades is one the room forgives —
		// it reads as a breath ending rather than a cut, and re-opening inside
		// the fade is inaudible. setTargetAtTime's tau is a third of the ramp
		// it reads as, since that is where it has all but arrived.
		const ms = openNow ? GATE_ATTACK_MS : GATE_RELEASE_MS;
		mic.gain.gain.setTargetAtTime(
			openNow ? 1 : 0,
			mic.ctx.currentTime,
			ms / 3000,
		);
	}

	/**
	 * SPEC: while the jukebox plays the threshold doubles. The gate reads it
	 * here and the meter's marker reads the same function, so the mark can
	 * never claim a gate the rider is not actually being held to (#289).
	 *
	 * Two things the doubling has to respect (#478). It pays for speaker
	 * bleed, so it applies only to ears that hear the deck: a rider with
	 * music at zero has no bleed to gate out and stays on what they set. And
	 * doubling is +6 dB, which walks off the top of the axis from a gate as
	 * low as half GATE_CEIL — unclamped, the meter pins its mark at 100% and
	 * the mic can stop opening at all the moment a track starts.
	 */
	function effectiveThreshold() {
		const bleed = deckPlaying && mixer.music > 0;
		return bleed ? clampThreshold(gateThreshold * 2) : gateThreshold;
	}

	function runGate() {
		if (!mic || (!micOn && !testing)) return;
		if (mode === 'ptt') {
			setGate(pttHeld);
			return;
		}
		// The hold no longer chases the timer that fed it (#214's fix): the
		// level arrives from the audio thread, at the same rate whether this
		// tab is in front or behind another window.
		const was = gate.open;
		gate = gateStep(gate, micLevel, effectiveThreshold(), performance.now());
		if (gate.open !== was) setGate(gate.open);
	}

	/** Mic test (#178): hear yourself through the gate before anyone else
	 * does. Same chain as transmission, output to the local speakers; the
	 * meter and the transmitting verdict run identically. Only outside a
	 * live mic — in voice, the meter is already the truth. */
	let testing = $state(false);
	async function startMicTest() {
		if (mic || testing) return;
		const { ctx, raw, gain, meter } = await buildChain();
		gain.connect(ctx.destination); // your own ears, not the room
		const dest = ctx.createMediaStreamDestination();
		mic = { ctx, raw, gain, meter, track: dest.stream.getAudioTracks()[0] };
		testing = true;
	}

	function stopMicTest() {
		if (!testing) return;
		testing = false;
		closeMic();
	}

	function closeMic() {
		if (mic) {
			const { ctx, raw, track } = mic;
			mic.meter.stop();
			room?.localParticipant.unpublishTrack(track);
			for (const t of raw.getTracks()) t.stop();
			void ctx.close();
		}
		mic = null;
		gate = GATE_SHUT;
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
	/** This connection's identity and the rider behind it (#293). */
	let myIdentity = '';
	let me = '';
	/**
	 * Video is keyed by RIDER — the tiles and the stage are — but tagged with
	 * the connection that published it: when a rider's older tab drops its
	 * camera, it must not delete the track their newer tab just put up.
	 */
	type Owned = { owner: string; track: RemoteTrack | LocalVideoTrack };
	const videoTracks = new Map<string, Owned>();
	const screenTracks = new Map<string, Owned>();
	/** Audio plumbing is per CONNECTION: one element and one gain each. */
	const audioElements = new Map<string, HTMLAudioElement>();
	// Per-rider output gain (#179): media-element → gain → speakers, so a
	// quiet teammate can go ABOVE unity — element.volume caps at 1, WebAudio
	// doesn't.
	let outCtx: AudioContext | null = null;
	let riderBus: DynamicsCompressorNode | null = null;
	const riderGains = new Map<string, GainNode>();
	const riderSources = new Map<string, MediaElementAudioSourceNode>();

	/** Forget a rider's track only if this connection is the one that owns it. */
	function dropOwned(map: Map<string, Owned>, rider: string, owner: string) {
		if (map.get(rider)?.owner !== owner) return false;
		map.delete(rider);
		return true;
	}

	function routeRiderAudio(identity: string, el: HTMLAudioElement) {
		try {
			if (!outCtx) {
				outCtx = new AudioContext();
				applySink();
			}
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
			gain.gain.value = mixer.riderGain(riderOf(identity));
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
	const onDeviceChange = () => void refreshDevices();
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisible);
		navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
	}

	function addScreen(id: string) {
		screenSeq += 1;
		screens = [...screens.filter((s) => s.id !== id), { id, key: screenSeq }];
	}

	function dropScreen(id: string) {
		screens = screens.filter((s) => s.id !== id);
		// A sharer stopping must not blank the stage for everyone — falling
		// back to null lets the derived pick the next newest share (#206).
		if (stagePick === `screen:${id}`) stagePick = null;
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

	/**
	 * The stage's menu: every share, then every open camera. Screens lead
	 * because a shared screen is why anyone looks at the stage at all.
	 */
	const stageSources = () => [
		...screens.map((s) => ({
			key: `screen:${s.id}`,
			id: s.id,
			kind: 'screen' as const,
			gen: s.key,
		})),
		...Object.entries(videoOf).map(([id, gen]) => ({
			key: `cam:${id}`,
			id,
			kind: 'cam' as const,
			gen,
		})),
	];

	// ── "I was in voice here" (#480) ─────────────────────────────────────────
	// A refresh kills the page and the LiveKit room with it. The note this
	// tab leaves behind is what lets the next page walk back in; it is
	// restamped while the call is live, so an hour of riding still reads as a
	// refresh, and torn up the moment the rider hangs up.
	const tab = tabId();
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	function noteVoice() {
		writeNote(tab, { slug, at: Date.now(), mic: micOn });
	}
	function startNote() {
		noteVoice();
		heartbeat ??= setInterval(noteVoice, REJOIN_HEARTBEAT_MS);
	}
	function stopNote() {
		if (heartbeat !== null) clearInterval(heartbeat);
		heartbeat = null;
	}

	/**
	 * Join the room's call. `mic: false` arrives listening only — the #480
	 * rejoin comes back in the state the rider left, and a rider who was
	 * muted stays muted. Nothing else passes it: the rail's button and the
	 * drop-rejoin (#219) keep the SPEC default of a mic already open.
	 */
	async function join({ mic: wantMic = true }: { mic?: boolean } = {}) {
		// Double-click or an impatient rail tap must not build a second
		// participant with the same identity (audit #219) — nor race the
		// SDK's own retry while it is reconnecting (#234).
		if (
			status === 'connecting' ||
			status === 'live' ||
			status === 'reconnecting'
		)
			return;
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
				...(camId ? { videoCaptureDefaults: { deviceId: camId } } : {}),
			});
			wire(room);
			await room.connect(res.data.url, res.data.token);
			myIdentity = room.localParticipant.identity;
			me = riderOf(myIdentity);
			status = 'live';
			myClaim = claimOf(room.localParticipant);
			// A tab already in the room could, in principle, hold a newer claim
			// than this one — check rather than assume newest-connected wins.
			for (const p of room.remoteParticipants.values()) considerClaim(p);
			// Post-permission the labels are real — the pickers can name devices.
			void refreshDevices();
			// Mic on by default (SPEC); a denied permission downgrades to
			// listen-only rather than failing the join.
			for (const p of room.remoteParticipants.values()) {
				const pub = p.getTrackPublication(Track.Source.Microphone);
				setVoice(riderOf(p.identity), pub && !pub.isMuted ? 'live' : 'muted');
			}
			// Away follows the rider across their screens (#706). A voice
			// reconnect or a second tab joining while the rider is away must not
			// quietly reopen a microphone the away button just closed.
			if (wantMic && !away) {
				try {
					await openMic();
					micOn = true;
					setVoice(me, 'live');
				} catch {
					micOn = false;
					setVoice(me, 'muted');
				}
			} else {
				micOn = false;
				setVoice(me, 'muted');
			}
			startNote();
		} catch (cause) {
			status = 'failed';
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	// ── One rider, several tabs (#293) ───────────────────────────────────────
	// LiveKit gives each tab its own participant now, so nothing evicts
	// anything; what is left is a product question — which tab holds the mic.
	// Newest wins: opening a room moves the mic to the tab you are looking at.
	//
	// A tab joining needs no announcement — LiveKit tells everyone, with a
	// server-assigned joinedAt that beats comparing browser clocks. Only an
	// explicit "use this tab instead" has to be broadcast, and by then the
	// sender is a participant the others already know. (Publishing a claim on
	// join instead looked simpler and did not work: the packet outruns the
	// join event, and the receiver gets it with no sender attached.)
	let myClaim: Claim | null = null;
	/** Whether the mic was open when this tab handed over, for taking it back. */
	let micBeforeHandoff = false;

	function claimOf(p: { identity: string; joinedAt?: Date }): Claim {
		return { identity: p.identity, at: p.joinedAt?.getTime() ?? Date.now() };
	}

	/** Stand down if this participant is a newer tab of mine. */
	function considerClaim(p: { identity: string; joinedAt?: Date }) {
		if (myClaim && yieldsTo(myClaim, claimOf(p))) void standDown();
	}

	/** Announce that the mic and camera are moving here, now. */
	function claimAv() {
		if (!room) return;
		myClaim = { identity: myIdentity, at: Date.now() };
		handedOff = false;
		void room.localParticipant
			.publishData(
				new TextEncoder().encode(
					JSON.stringify({ t: 'av-claim', at: myClaim.at }),
				),
				{ reliable: true },
			)
			// A claim that never lands leaves both tabs publishing: doubled
			// audio, which the rider can hear and fix. Better than a silent
			// stand-down on a channel that failed.
			.catch(() => {});
	}

	/**
	 * Is any OTHER connection of this rider publishing an open mic?
	 *
	 * Muting here is unpublishing, and `voice` is keyed by rider while the
	 * events that drive it are per connection — so a tab standing down
	 * broadcasts an unpublish for a rider who is still live in the tab that
	 * just took over, and everyone reads them as muted. Ask the room instead
	 * of trusting the event.
	 */
	function micLive(rider: string, except: string) {
		if (!room) return false;
		const asConnection = (p: {
			identity: string;
			getTrackPublication: (
				source: Track.Source,
			) => { isMuted: boolean } | undefined;
		}) => {
			const pub = p.getTrackPublication(Track.Source.Microphone);
			return { identity: p.identity, micOpen: !!pub && !pub.isMuted };
		};
		return micLiveElsewhere(
			[room.localParticipant, ...room.remoteParticipants.values()].map(
				asConnection,
			),
			rider,
			except,
		);
	}

	/** Is any other connection of this rider still in the room? */
	function stillHere(rider: string, except: string) {
		if (!room) return false;
		for (const p of room.remoteParticipants.values())
			if (p.identity !== except && riderOf(p.identity) === rider) return true;
		return false;
	}

	/** Take the mic and camera back into this tab; the others stand down. */
	async function takeOver({ reopenMic = true } = {}) {
		if (!room) return;
		claimAv();
		if (reopenMic && !micOn) {
			try {
				await openMic();
				micOn = true;
			} catch {
				micOn = false;
			}
			setVoice(me, micOn ? 'live' : 'muted');
		}
		noteVoice();
	}

	/**
	 * Publish the camera. Trust the publication rather than the intent: a
	 * device the browser refuses would otherwise leave camOn lying, and the
	 * tile draws a frame that never arrives.
	 */
	async function openCam() {
		if (camOn || !room) return;
		camOn = true;
		try {
			await room.localParticipant.setCameraEnabled(true);
			const track = room.localParticipant.getTrackPublication(
				Track.Source.Camera,
			)?.videoTrack;
			if (track) {
				videoTracks.set(me, { owner: myIdentity, track });
				bumpVideo(me);
			} else {
				await closeCam();
			}
		} catch {
			camOn = false;
		}
	}

	/**
	 * Step out, or come back (#706). Deliberately not standDown(): that says
	 * "the mic lives in another tab of yours", which is what the rail renders
	 * and what the mic button then acts on. Away is the rider being elsewhere,
	 * and their own mic button still means what it says.
	 */
	async function setAway(next: boolean) {
		if (next === away) return;
		away = next;
		// A rider can step away without joining voice. Keep the state so a
		// later voice join stays listen-only; there is no capture to change yet.
		if (!room) return;
		if (away) {
			micBeforeAway = micOn;
			camBeforeAway = camOn;
			if (micOn) {
				closeMic();
				micOn = false;
			}
			setVoice(me, 'muted');
			noteVoice();
			await closeCam();
			return;
		}
		if (micBeforeAway && !micOn) {
			try {
				await openMic();
				micOn = true;
			} catch {
				micOn = false;
			}
			setVoice(me, micOn ? 'live' : 'muted');
			noteVoice();
		}
		if (camBeforeAway && !camOn) {
			await openCam();
		}
	}

	/**
	 * Put the camera down and hand the device back to the machine. Three
	 * callers now (the button, a handoff, stepping away in #706), and
	 * unpublishing alone is not enough: it can leave the capture open, and
	 * then the camera reads as "in use" to every other tab and app until the
	 * page closes (rider report: the camera stopped working in Chrome).
	 */
	async function closeCam() {
		if (!camOn || !room) return;
		camOn = false;
		const track = room.localParticipant.getTrackPublication(
			Track.Source.Camera,
		)?.videoTrack;
		await room.localParticipant.setCameraEnabled(false).catch(() => {});
		track?.mediaStreamTrack?.stop();
		if (dropOwned(videoTracks, me, myIdentity)) dropVideo(me);
	}

	/** Another tab of yours took over: drop the mic and camera, keep listening. */
	async function standDown() {
		if (handedOff) return;
		handedOff = true;
		micBeforeHandoff = micOn;
		if (micOn) {
			closeMic();
			micOn = false;
		}
		// The note stops vetoing a rejoin in the tab that now holds the mic.
		noteVoice();
		await closeCam();
		// Screenshare deliberately stays. Sharing a laptop screen while riding
		// from the tablet is a real thing to want, and unlike a mic two shares
		// do not fight — they are silent. `screenTracks` keys by rider though,
		// so the room shows one of them: the last to publish.
	}

	function wire(r: Room) {
		// Only an explicit takeover arrives this way. The sender must be a
		// participant we know — an unattributed packet is not something to
		// mute a rider's microphone over.
		r.on(RoomEvent.DataReceived, (payload, participant) => {
			if (!participant || !myClaim) return;
			let at: unknown;
			try {
				const msg = JSON.parse(new TextDecoder().decode(payload));
				if (msg?.t !== 'av-claim') return;
				at = msg.at;
			} catch {
				return; // not ours to read
			}
			if (typeof at !== 'number') return;
			if (yieldsTo(myClaim, { identity: participant.identity, at }))
				void standDown();
		});
		r.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
			const rider = riderOf(participant.identity);
			if (track.kind === Track.Kind.Video) {
				const owned = { owner: participant.identity, track };
				if (pub.source === Track.Source.ScreenShare) {
					screenTracks.set(rider, owned);
					addScreen(rider);
				} else {
					videoTracks.set(rider, owned);
					bumpVideo(rider);
				}
			}
			if (track.kind === Track.Kind.Audio) {
				const el = track.attach() as HTMLAudioElement;
				audioElements.set(participant.identity, el);
				document.body.appendChild(el);
				routeRiderAudio(participant.identity, el);
				// Mute here is unpublish, not track-mute (the gate owns the gain),
				// so the mic chip must follow the publication itself — Muted/
				// Unmuted never fire and ParticipantConnected ran pre-publish.
				if (pub.source === Track.Source.Microphone) setVoice(rider, 'live');
			}
		});
		r.on(RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
			const rider = riderOf(participant.identity);
			if (track.kind === Track.Kind.Video) {
				if (pub.source === Track.Source.ScreenShare) {
					if (dropOwned(screenTracks, rider, participant.identity))
						dropScreen(rider);
				} else if (dropOwned(videoTracks, rider, participant.identity)) {
					dropVideo(rider);
				}
			}
			if (track.kind === Track.Kind.Audio) {
				track.detach().forEach((el) => el.remove());
				audioElements.delete(participant.identity);
				riderGains.get(participant.identity)?.disconnect();
				riderGains.delete(participant.identity);
				riderSources.get(participant.identity)?.disconnect();
				riderSources.delete(participant.identity);
				if (
					pub.source === Track.Source.Microphone &&
					!micLive(rider, participant.identity)
				)
					setVoice(rider, 'muted');
			}
		});
		// The browser's own "Stop sharing" bar ends the track behind our back:
		// LiveKit unpublishes it for us (handleTrackEnded) and says so here. Without
		// this the button still offers to stop a share that is already over, and
		// the local stage sits on its last frame while the room sees nothing.
		r.on(RoomEvent.LocalTrackUnpublished, (pub) => {
			if (pub.source !== Track.Source.ScreenShare) return;
			sharing = false;
			if (dropOwned(screenTracks, me, myIdentity)) dropScreen(me);
		});
		const audioState = (p: {
			identity: string;
			getTrackPublication: (source: Track.Source) => unknown;
		}) => {
			const pub = p.getTrackPublication(Track.Source.Microphone) as
				{ isMuted: boolean } | undefined;
			setVoice(riderOf(p.identity), pub && !pub.isMuted ? 'live' : 'muted');
		};
		r.on(RoomEvent.ParticipantConnected, (p) => {
			audioState(p);
			// Another tab of yours just opened: it is the one you are looking at.
			considerClaim(p);
		});
		r.on(RoomEvent.ParticipantDisconnected, (p) => {
			const rider = riderOf(p.identity);
			// Their other tab may still be in the room — one closed tab does not
			// take a rider out of voice (#293).
			if (!stillHere(rider, p.identity)) setVoice(rider, null);
			// The tab that took the mic is gone: this one may have it back, and
			// it goes back the way it left, without asking (ux.md: recovery is
			// automatic where it can be).
			if (handedOff && rider === me && !stillHere(me, myIdentity))
				void takeOver({ reopenMic: micBeforeHandoff });
		});
		r.on(RoomEvent.TrackMuted, (pub, p) => {
			const rider = riderOf(p.identity);
			if (pub.kind === Track.Kind.Audio && !micLive(rider, p.identity))
				setVoice(rider, 'muted');
		});
		r.on(RoomEvent.TrackUnmuted, (pub, p) => {
			if (pub.kind === Track.Kind.Audio) setVoice(riderOf(p.identity), 'live');
		});
		r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
			const next: Record<string, boolean> = {};
			for (const p of speakers) next[riderOf(p.identity)] = true;
			speaking = next;
		});
		// Media-interrupted retry window (#234, errors.md): audio is gapped
		// while the SDK rebuilds the connection — say so on the dashboard.
		// SignalReconnecting stays transparent by design (RESEARCH.md): media
		// keeps flowing while only the signal socket rebuilds.
		r.on(RoomEvent.Reconnecting, () => {
			if (status === 'live') status = 'reconnecting';
		});
		r.on(RoomEvent.Reconnected, () => {
			if (status === 'reconnecting') status = 'live';
		});
		r.on(RoomEvent.Disconnected, () => {
			const unexpected = status === 'live' || status === 'reconnecting';
			for (const el of audioElements.values()) el.remove();
			audioElements.clear();
			videoTracks.clear();
			videoOf = {};
			screenTracks.clear();
			screens = [];
			stagePick = null;
			voice = {};
			// Nobody is talking to a room you are no longer in — a stale
			// speaking flag parked music and cues at duck level forever, and
			// camOn, sharing and micOn all lied about dead tracks (#219, #354).
			speaking = {};
			camOn = false;
			micOn = false;
			sharing = false;
			handedOff = false;
			myClaim = null;
			room = null;
			closeMic();
			if (unexpected) {
				// Stop restamping, but leave the note behind: a refresh during
				// the drop-rejoin window is still a refresh (#219, #480). Only
				// on an unexpected drop — a clean disconnect is either leave(),
				// which tears the note up itself, or join() clearing a stale
				// room, whose late event must not stop the heartbeat that join
				// is about to start.
				stopNote();
				status = 'off';
				dropped += 1;
			}
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
		/** Stepped out (#706) — the mic and camera are held down until back. */
		get away() {
			return away;
		},
		setAway,
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
		/** What is gating you right now — the stored value, doubled by music. */
		get effectiveGateThreshold() {
			return effectiveThreshold();
		},
		get pttHeld() {
			return pttHeld;
		},
		setMode(next: 'gate' | 'ptt') {
			mode = next;
			persistVoice();
			if (next === 'gate') gate = GATE_SHUT;
			runGate();
		},
		setGateThreshold(next: number) {
			gateThreshold = clampThreshold(next);
			persistVoice();
			// Tuning mid-sentence must land on this breath, not the next tick.
			runGate();
		},
		get micTesting() {
			return testing;
		},
		/** Your mic and camera live in another of your tabs (#293). */
		get handedOff() {
			return handedOff;
		},
		/** Bring them back here. */
		takeOver: () => takeOver(),
		// ── Devices: what's plugged in, what's chosen, and switching live ──────
		get mics() {
			return mics();
		},
		get cams() {
			return cams();
		},
		get outs() {
			return outs();
		},
		get micId() {
			return micId;
		},
		get camId() {
			return camId;
		},
		get outId() {
			return outId;
		},
		get canPickOutput() {
			return canPickOutput;
		},
		refreshDevices,
		/** Switching mid-transmission rebuilds the capture chain in place. */
		async setMic(id: string) {
			micId = id;
			persistDevices();
			if (testing) {
				stopMicTest();
				await startMicTest().catch(() => {
					testing = false;
				});
			} else if (micOn) {
				try {
					await openMic();
				} catch {
					micOn = false;
					setVoice(me, 'muted');
				}
			}
		},
		async setCam(id: string) {
			camId = id;
			persistDevices();
			if (camOn && room) {
				await room.switchActiveDevice('videoinput', id).catch(() => {});
			}
		},
		setOut(id: string) {
			outId = id;
			persistDevices();
			applySink();
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
		/**
		 * The room's deck, as the tick reports it. Whether it raises this
		 * rider's gate is effectiveThreshold's call — their own music level
		 * decides whether there is any bleed to gate out (#478).
		 */
		setDeckPlaying(playing: boolean) {
			deckPlaying = playing;
		},
		/**
		 * Applies the mixer's per-rider gain live (#179, #463). One fader per
		 * rider, however many tabs they are connected from; a short ramp, so a
		 * dragged slider does not zipper.
		 */
		setRiderGain(id: string, v: number, name?: string) {
			mixer.setRiderGain(id, v, name);
			if (!outCtx) return;
			for (const [identity, gain] of riderGains)
				if (riderOf(identity) === id)
					gain.gain.setTargetAtTime(
						mixer.riderGain(id),
						outCtx.currentTime,
						0.02,
					);
		},
		join,
		async toggleMic() {
			if (!room) return;
			if (testing) stopMicTest();
			// Pressing the mic in a tab that stood down means "bring it here",
			// not "publish a second one" — the rail says the mic lives in
			// another tab, and the button must not quietly contradict it.
			if (handedOff) {
				await takeOver();
				return;
			}
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
			setVoice(me, micOn || micLive(me, myIdentity) ? 'live' : 'muted');
			noteVoice();
		},
		async toggleCam() {
			if (!room) return;
			if (camOn) {
				await closeCam();
				return;
			}
			await openCam();
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
				if (sharing && track) {
					screenTracks.set(me, { owner: myIdentity, track });
					addScreen(me);
				} else {
					sharing = false;
					if (dropOwned(screenTracks, me, myIdentity)) dropScreen(me);
				}
			} catch {
				sharing = false;
			}
		},
		/** Everything the stage can show, screens first (#280). */
		get stageSources() {
			return stageSources();
		},
		/** The rider's pick. The room page resolves it against the full list —
		 *  longer than ours, the jukebox video is on it too (#316). */
		get stagePick() {
			return stagePick;
		},
		/** Pick a source, or null to follow the newest share again. */
		setStage(key: string | null) {
			stagePick = key;
		},
		/** The stage surface: a screen is a document (contain), a face isn't.
		 *  A key we do not know is not ours to draw — the jukebox seats itself. */
		attachStage(container: HTMLElement, key: string) {
			const source = stageSources().find((candidate) => candidate.key === key);
			mountTrack(
				container,
				source
					? (source.kind === 'screen' ? screenTracks : videoTracks).get(
							source.id,
						)?.track
					: undefined,
				source?.kind === 'screen' ? 'contain' : 'cover',
			);
		},
		attach(riderId: string, container: HTMLElement) {
			mountTrack(container, videoTracks.get(riderId)?.track, 'cover');
		},
		leave() {
			// Hanging up is the rider saying so: leaving and then reloading
			// must not drag them back in (#480).
			stopNote();
			clearNote(tab);
			// Same for leaving: every local capture goes back to the machine.
			for (const kind of [Track.Source.Camera, Track.Source.ScreenShare]) {
				const pub = room?.localParticipant.getTrackPublication(kind);
				pub?.videoTrack?.mediaStreamTrack?.stop();
			}
			closeMic();
			void room?.disconnect();
			room = null;
			status = 'off';
			micOn = camOn = sharing = away = false;
			voice = {};
			speaking = {};
			// This av instance dies with the connection: audio graph and
			// listener go with it, or six room-hops exhaust the browser's
			// AudioContext budget (audit #219).
			if (typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', onVisible);
				navigator.mediaDevices?.removeEventListener(
					'devicechange',
					onDeviceChange,
				);
			}
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
