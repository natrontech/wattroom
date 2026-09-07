import type {
	LocalVideoTrack,
	RemoteTrack,
	Room as LiveKitRoom,
	Track as LiveKitTrack,
	TrackPublication as LiveKitPublication,
} from 'livekit-client';
import { api } from '$lib/api';
import { mixer } from '$lib/sound/mixer.svelte';
import { createDeviceChoices } from '$lib/room/av-devices.svelte';
import { createStage } from '$lib/room/av-stage.svelte';
import { canPickOutput, createRiderOutput } from '$lib/room/av-output';
import { createSpeaking } from '$lib/room/speaking';
import { type MediaDevice, describeMediaError } from '$lib/room/media-error';
import { serverNow } from '$lib/room/server-clock';
import { createMicChain } from '$lib/room/mic-chain.svelte';
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

type LiveKitClient = typeof import('livekit-client');

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

/**
 * Why the last thing the rider asked of voice did not happen (#642). Not a
 * toast: a rider on a bike reads it a minute later, mid-interval, so the
 * sidebar keeps it until the next attempt clears it. `signIn` marks the one
 * failure whose remedy is a page, not a retry.
 */
export interface AvError {
	message: string;
	signIn: boolean;
}

const VOICE_UNREACHABLE =
	'Voice could not connect — check your connection and try again.';

export function createRoomAv(slug: string) {
	// Keep the SDK out of the shell and login chunks. It is loaded only when a
	// rider actually starts AV, after the token request has succeeded.
	let liveKit: LiveKitClient | null = null;
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
	let error = $state<AvError | null>(null);
	/** Record a device the browser refused; a closed share picker says nothing. */
	function failedMedia(cause: unknown, device: MediaDevice) {
		const message = describeMediaError(cause, device);
		if (message) error = { message, signIn: false };
	}
	const stage = createStage();
	let speaking = $state<Record<string, boolean>>({});
	/** Bumped when LiveKit drops us while live — the connection auto-rejoins
	 * once with a fresh token (#219: token expiry, transient drops). */
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

	// Device selection and the rider-audio bus own their own state now (#892).
	// The bus reads the chosen sink through a getter: the AudioContext outlives
	// any one pick.
	const devices = createDeviceChoices();
	// Who is talking, measured off the voice on its way to the speakers (#987)
	// rather than remembered from the server's broadcast. `level` answers
	// whether anything actually moved, so the reactive write happens on a
	// change rather than fifty times a second per rider.
	const talk = createSpeaking(riderOf);
	const output = createRiderOutput(
		() => devices.outId,
		(identity, level) => {
			if (talk.level(identity, level, performance.now()))
				speaking = { ...talk.riders };
		},
	);

	/**
	 * This machine's microphone (#892). It owns the capture, the meter, the
	 * gate and the mic test; this closure owns the connection it publishes to,
	 * and hands it the four functions it needs to reach one.
	 */
	const chain = createMicChain({
		devices,
		publish: async (track) => {
			await room?.localParticipant.publishTrack(track, {
				source: liveKit!.Track.Source.Microphone,
			});
		},
		unpublish: (track) => room?.localParticipant.unpublishTrack(track),
		live: () => micOn,
		heard: (level) => {
			if (talk.level(myIdentity, level, performance.now()))
				speaking = { ...talk.riders };
		},
		silenced: () => {
			if (talk.drop(myIdentity)) speaking = { ...talk.riders };
		},
		captureLost: () => {
			micOn = false;
			if (room) setVoice(me, 'muted');
		},
	});

	/**
	 * Open the mic and let `micOn` say what actually happened: a device the
	 * browser refuses downgrades to listening rather than failing the caller.
	 */
	async function tryOpenMic() {
		try {
			await chain.open();
			micOn = true;
			// A mic that opens clears the last refusal (#642): the sidebar must
			// not keep explaining a failure that has since been fixed.
			error = null;
		} catch (cause) {
			micOn = false;
			failedMedia(cause, 'microphone');
		}
	}

	function setVoice(id: string, state: 'live' | 'muted' | null) {
		const next = { ...voice };
		if (state === null) delete next[id];
		else next[id] = state;
		voice = next;
	}

	let room: LiveKitRoom | null = null;
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
	/** Forget a rider's track only if this connection is the one that owns it. */
	function dropOwned(map: Map<string, Owned>, rider: string, owner: string) {
		if (map.get(rider)?.owner !== owner) return false;
		map.delete(rider);
		return true;
	}

	/**
	 * Same ownership question, without forgetting: a camera going quiet keeps
	 * its subscription, so the mute handlers ask who owns the seat and leave
	 * the track where it is for the unmute.
	 */
	function ownsTrack(map: Map<string, Owned>, rider: string, owner: string) {
		return map.get(rider)?.owner === owner;
	}

	function onVisible() {
		if (document.visibilityState !== 'visible') return;
		// Browsers may suspend audio graphs in long-hidden tabs; coming
		// back must not need a rejoin (#214).
		chain.resume();
		output.resume();
	}
	/**
	 * A chosen mic that is no longer plugged in stops being chosen (#640), so
	 * the next open lands on the default instead of failing on an exact
	 * deviceId. Only judged against a list that names its devices: before
	 * permission, enumerateDevices hands back blank ids, and a blank list must
	 * not un-choose a headset that is sitting right there.
	 */
	const onDeviceChange = async () => {
		await devices.refresh();
		devices.forgetMicIfUnplugged();
	};
	/** Idempotent: the same handlers, so a second call adds nothing. leave()
	 * removes them, and the sidebar's Join voice reuses this instance (#824). */
	function listen() {
		if (typeof document === 'undefined') return;
		document.addEventListener('visibilitychange', onVisible);
		navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
	}
	listen();

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
	 * Join the room's call. `mic: false` arrives listening only. The rail's
	 * button passes nothing and gets the SPEC default of a mic already open;
	 * the two resumes — the #480 refresh and the #219 drop-rejoin — pass the
	 * state the rider left in, so a rider who was muted stays muted (#641).
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
		// A fault from a previous call, or from a mic test that died, is not
		// this join's — it surfaced as "your microphone stopped" on a
		// listen-only join that never opened one (#824).
		chain.clearFault();
		listen();
		const res = await api<{ url: string; token: string }>(
			`/api/rooms/${slug}/av-token`,
		);
		if (!res.ok) {
			status = 'failed';
			// 401 is the one refusal a retry cannot fix (#642).
			error = {
				message: res.error.message,
				signIn: res.error.error === 'unauthorized',
			};
			return;
		}
		try {
			const client = await import('livekit-client');
			liveKit = client;
			// No audioCaptureDefaults: this room never opens the mic through
			// LiveKit. captureMic() does, with MIC_CONSTRAINTS (room/capture),
			// and publishes the processed track — so a second copy here could
			// only ever be a second source of truth that never takes effect,
			// and this one was already missing autoGainControl (#671). Video
			// IS LiveKit's own capture (setCameraEnabled), so its defaults
			// stay.
			room = new client.Room({
				...(devices.camId
					? { videoCaptureDefaults: { deviceId: devices.camId } }
					: {}),
			});
			wire(room, client);
			await room.connect(res.data.url, res.data.token);
			myIdentity = room.localParticipant.identity;
			me = riderOf(myIdentity);
			status = 'live';
			myClaim = claimOf(room.localParticipant);
			// A tab already in the room could, in principle, hold a newer claim
			// than this one — check rather than assume newest-connected wins.
			for (const p of room.remoteParticipants.values()) considerClaim(p);
			// Post-permission the labels are real — the pickers can name devices.
			void devices.refresh();
			// Mic on by default (SPEC); a denied permission downgrades to
			// listen-only rather than failing the join.
			for (const p of room.remoteParticipants.values()) {
				const pub = p.getTrackPublication(liveKit!.Track.Source.Microphone);
				setVoice(riderOf(p.identity), pub && !pub.isMuted ? 'live' : 'muted');
			}
			// Away follows the rider across their screens (#706). A voice
			// reconnect or a second tab joining while the rider is away must not
			// quietly reopen a microphone the away button just closed.
			if (wantMic && !away) {
				await tryOpenMic();
				setVoice(me, micOn ? 'live' : 'muted');
			} else {
				micOn = false;
				setVoice(me, 'muted');
			}
			startNote();
		} catch {
			// LiveKit's own message is written for developers; the rider needs
			// the step that failed and the one thing to try (errors.md).
			status = 'failed';
			error = { message: VOICE_UNREACHABLE, signIn: false };
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
	/**
	 * Whether the mic was open when LiveKit dropped us, for the rejoin (#641).
	 * The Disconnected handler clears `micOn` before the rejoin fires, and a
	 * rider who muted for a phone call must not come back publishing.
	 */
	let micBeforeDrop = false;

	function claimOf(p: { identity: string; joinedAt?: Date }): Claim {
		return { identity: p.identity, at: p.joinedAt?.getTime() ?? Date.now() };
	}

	/** Stand down if this participant is a newer tab of mine. */
	function considerClaim(p: { identity: string; joinedAt?: Date }) {
		if (myClaim && yieldsTo(myClaim, claimOf(p))) void standDown();
	}

	/**
	 * Announce that the mic and camera are moving here, now.
	 *
	 * Stamped on the server's clock, because the join stamps it competes
	 * with are LiveKit's (#646). A browser clock behind the server made the
	 * takeover read older than the incumbent's join, so it never stood down;
	 * one ahead made a tab opened right after read older than the takeover,
	 * so the takeover never stood down for it. Both ways, doubled audio.
	 */
	function claimAv() {
		if (!room) return;
		myClaim = { identity: myIdentity, at: serverNow() };
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
				source: LiveKitTrack.Source,
			) => { isMuted: boolean } | undefined;
		}) => {
			const pub = p.getTrackPublication(liveKit!.Track.Source.Microphone);
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
			await tryOpenMic();
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
				liveKit!.Track.Source.Camera,
			)?.videoTrack;
			if (track) {
				videoTracks.set(me, { owner: myIdentity, track });
				stage.bumpVideo(me);
			} else {
				await closeCam();
			}
		} catch (cause) {
			camOn = false;
			failedMedia(cause, 'camera');
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
		// Stepping out silences the speakers too (#875): voices, the jukebox
		// and the cues all play to an empty chair otherwise. The faders keep
		// their values, so coming back restores the mix and not a default.
		mixer.setMuted(next);
		output.applyGains();
		// A rider can step away without joining voice. Keep the state so a
		// later voice join stays listen-only; there is no capture to change yet.
		if (!room) return;
		if (away) {
			micBeforeAway = micOn;
			camBeforeAway = camOn;
			// Stepping away is the rider closing the mic, not losing it.
			chain.clearFault();
			if (micOn) {
				chain.close();
				micOn = false;
			}
			setVoice(me, 'muted');
			noteVoice();
			await closeCam();
			return;
		}
		if (micBeforeAway && !micOn) {
			await tryOpenMic();
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
			liveKit!.Track.Source.Camera,
		)?.videoTrack;
		await room.localParticipant.setCameraEnabled(false).catch(() => {});
		track?.mediaStreamTrack?.stop();
		if (dropOwned(videoTracks, me, myIdentity)) stage.dropVideo(me);
	}

	/** Another tab of yours took over: drop the mic and camera, keep listening. */
	async function standDown() {
		if (handedOff) return;
		handedOff = true;
		// The mic lives in the other tab now: no fault to reconnect from here.
		chain.clearFault();
		micBeforeHandoff = micOn;
		if (micOn) {
			chain.close();
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

	function wire(r: LiveKitRoom, client: LiveKitClient) {
		// Only an explicit takeover arrives this way. The sender must be a
		// participant we know — an unattributed packet is not something to
		// mute a rider's microphone over.
		r.on(client.RoomEvent.DataReceived, (payload, participant) => {
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
		r.on(client.RoomEvent.TrackSubscribed, (track, pub, participant) => {
			const rider = riderOf(participant.identity);
			if (track.kind === client.Track.Kind.Video) {
				const owned = { owner: participant.identity, track };
				// A publication can arrive already muted — a rider who switched
				// their camera off before you walked in. Record the track either
				// way, so the unmute has something to give the seat back to, but
				// only claim a seat once there is a picture in it (#851).
				if (pub.source === client.Track.Source.ScreenShare) {
					screenTracks.set(rider, owned);
					if (!pub.isMuted) stage.addScreen(rider);
				} else {
					videoTracks.set(rider, owned);
					if (!pub.isMuted) stage.bumpVideo(rider);
				}
			}
			if (track.kind === client.Track.Kind.Audio) {
				const el = track.attach() as HTMLAudioElement;
				audioElements.set(participant.identity, el);
				document.body.appendChild(el);
				output.route(participant.identity, el);
				// Mute here is unpublish, not track-mute (the gate owns the gain),
				// so the mic chip must follow the publication itself — Muted/
				// Unmuted never fire and ParticipantConnected ran pre-publish.
				if (pub.source === client.Track.Source.Microphone)
					setVoice(rider, 'live');
			}
		});
		r.on(client.RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
			const rider = riderOf(participant.identity);
			if (track.kind === client.Track.Kind.Video) {
				if (pub.source === client.Track.Source.ScreenShare) {
					if (dropOwned(screenTracks, rider, participant.identity))
						stage.dropScreen(rider);
				} else if (dropOwned(videoTracks, rider, participant.identity)) {
					stage.dropVideo(rider);
				}
			}
			if (track.kind === client.Track.Kind.Audio) {
				track.detach().forEach((el) => el.remove());
				audioElements.delete(participant.identity);
				output.drop(participant.identity);
				// The meter went with the track, so nothing can report this
				// voice again — and a flag nothing will ever clear is what
				// left riders ringed forever (#987).
				if (talk.drop(participant.identity)) speaking = { ...talk.riders };
				if (
					pub.source === client.Track.Source.Microphone &&
					!micLive(rider, participant.identity)
				)
					setVoice(rider, 'muted');
			}
		});
		// The browser's own "Stop sharing" bar ends the track behind our back:
		// LiveKit unpublishes it for us (handleTrackEnded) and says so here. Without
		// this the button still offers to stop a share that is already over, and
		// the local stage sits on its last frame while the room sees nothing.
		r.on(client.RoomEvent.LocalTrackUnpublished, (pub) => {
			if (pub.source !== client.Track.Source.ScreenShare) return;
			sharing = false;
			if (dropOwned(screenTracks, me, myIdentity)) stage.dropScreen(me);
		});
		const audioState = (p: {
			identity: string;
			getTrackPublication: (source: LiveKitTrack.Source) => unknown;
		}) => {
			const pub = p.getTrackPublication(client.Track.Source.Microphone) as
				{ isMuted: boolean } | undefined;
			setVoice(riderOf(p.identity), pub && !pub.isMuted ? 'live' : 'muted');
		};
		r.on(client.RoomEvent.ParticipantConnected, (p) => {
			audioState(p);
			// Another tab of yours just opened: it is the one you are looking at.
			considerClaim(p);
		});
		r.on(client.RoomEvent.ParticipantDisconnected, (p) => {
			const rider = riderOf(p.identity);
			// Belt and braces: TrackUnsubscribed normally arrives first and takes
			// the meter with it, but a connection dropped hard may skip it.
			if (talk.drop(p.identity)) speaking = { ...talk.riders };
			// Their other tab may still be in the room — one closed tab does not
			// take a rider out of voice (#293).
			if (!stillHere(rider, p.identity)) setVoice(rider, null);
			// The tab that took the mic is gone: this one may have it back, and
			// it goes back the way it left, without asking (ux.md: recovery is
			// automatic where it can be).
			if (handedOff && rider === me && !stillHere(me, myIdentity))
				void takeOver({ reopenMic: micBeforeHandoff });
		});
		// A camera switched off is a MUTE, not an unpublish — livekit-client
		// only unpublishes a screenshare on disable. Unheard, the subscription
		// survived, the seat went on claiming "camera on", and the tile drew an
		// attached element with no frames in it instead of the rider's mark
		// (#851). Both directions run through the same pair the subscribe path
		// uses, so the stage's menu and the member list follow too.
		function setPicture(pub: LiveKitPublication, p: { identity: string }) {
			if (pub.kind !== client.Track.Kind.Video) return;
			const rider = riderOf(p.identity);
			const screen = pub.source === client.Track.Source.ScreenShare;
			const tracks = screen ? screenTracks : videoTracks;
			if (!ownsTrack(tracks, rider, p.identity)) return;
			if (pub.isMuted) {
				if (screen) stage.dropScreen(rider);
				else stage.dropVideo(rider);
				return;
			}
			// Only when the seat is empty: your own camera bumps itself on the
			// way up, and a second bump re-keys the attach for a blink.
			if (screen) stage.addScreen(rider);
			else if (!stage.hasVideo(rider)) stage.bumpVideo(rider);
		}
		r.on(client.RoomEvent.TrackMuted, (pub, p) => {
			const rider = riderOf(p.identity);
			if (pub.kind === client.Track.Kind.Audio && !micLive(rider, p.identity))
				setVoice(rider, 'muted');
			setPicture(pub, p);
		});
		r.on(client.RoomEvent.TrackUnmuted, (pub, p) => {
			if (pub.kind === client.Track.Kind.Audio)
				setVoice(riderOf(p.identity), 'live');
			setPicture(pub, p);
		});
		// Media-interrupted retry window (#234, errors.md): audio is gapped
		// while the SDK rebuilds the connection — say so on the dashboard.
		// SignalReconnecting stays transparent by design (RESEARCH.md): media
		// keeps flowing while only the signal socket rebuilds.
		r.on(client.RoomEvent.Reconnecting, () => {
			if (status === 'live') status = 'reconnecting';
		});
		r.on(client.RoomEvent.Reconnected, () => {
			if (status === 'reconnecting') status = 'live';
		});
		r.on(client.RoomEvent.Disconnected, () => {
			const unexpected = status === 'live' || status === 'reconnecting';
			for (const el of audioElements.values()) el.remove();
			audioElements.clear();
			videoTracks.clear();
			screenTracks.clear();
			stage.clear();
			voice = {};
			// Nobody is talking to a room you are no longer in — a stale
			// speaking flag parked music and cues at duck level forever, and
			// camOn, sharing and micOn all lied about dead tracks (#219, #354).
			talk.clear();
			speaking = {};
			camOn = false;
			micBeforeDrop = micOn;
			micOn = false;
			sharing = false;
			handedOff = false;
			myClaim = null;
			room = null;
			chain.close();
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
		/** What the drop-rejoin should do with the mic: what the rider had. */
		get micBeforeDrop() {
			return micBeforeDrop;
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
			return stage.videoOf;
		},
		get speaking() {
			return speaking;
		},
		get voice() {
			return voice;
		},
		get micLevel() {
			return chain.level;
		},
		get transmitting() {
			return chain.transmitting;
		},
		get mode() {
			return chain.mode;
		},
		get gateThreshold() {
			return chain.threshold;
		},
		/** What is gating you right now — the stored value, doubled by music. */
		get effectiveGateThreshold() {
			return chain.effectiveThreshold;
		},
		get pttHeld() {
			return chain.pttHeld;
		},
		setMode(next: 'gate' | 'ptt') {
			chain.setMode(next);
		},
		setGateThreshold(next: number) {
			// Tuning mid-sentence must land on this breath, not the next tick.
			chain.setThreshold(next);
		},
		get micTesting() {
			return chain.testing;
		},
		/** Your mic and camera live in another of your tabs (#293). */
		get handedOff() {
			return handedOff;
		},
		/** Bring them back here. */
		takeOver: () => takeOver(),
		/** The capture died under an open mic (#640) and nothing has reopened it. */
		get micFault() {
			return chain.fault;
		},
		/**
		 * The banner's one big button: open the mic again. A device still
		 * missing leaves the fault standing — the banner is telling the truth
		 * and the button is the way back once the headset is plugged in.
		 */
		async reconnectMic() {
			// The same guards the mic button has (#824): in a tab that stood
			// down the mic lives elsewhere, and away means closed on purpose —
			// reconnecting here would publish a second one.
			if (!room || handedOff || away) {
				chain.clearFault();
				return;
			}
			await tryOpenMic();
			setVoice(me, micOn || micLive(me, myIdentity) ? 'live' : 'muted');
			noteVoice();
		},
		// ── Devices: what's plugged in, what's chosen, and switching live ──────
		get mics() {
			return devices.mics;
		},
		get cams() {
			return devices.cams;
		},
		get outs() {
			return devices.outs;
		},
		get micId() {
			return devices.micId;
		},
		get camId() {
			return devices.camId;
		},
		get outId() {
			return devices.outId;
		},
		get canPickOutput() {
			return canPickOutput;
		},
		refreshDevices: devices.refresh,
		/** Switching mid-transmission rebuilds the capture chain in place. */
		async setMic(id: string) {
			devices.setMic(id);
			if (chain.testing) {
				chain.stopTest();
				await chain.startTest().catch((cause) => {
					chain.stopTest();
					failedMedia(cause, 'microphone');
				});
			} else if (micOn) {
				try {
					await chain.open();
				} catch (cause) {
					// Dropped to muted — and told why, the way a join is (#824).
					micOn = false;
					setVoice(me, 'muted');
					failedMedia(cause, 'microphone');
				}
			}
		},
		async setCam(id: string) {
			devices.setCam(id);
			if (camOn && room) {
				await room.switchActiveDevice('videoinput', id).catch(() => {});
			}
		},
		setOut(id: string) {
			devices.setOut(id);
			output.applySink();
		},
		async toggleMicTest() {
			if (chain.testing) chain.stopTest();
			else
				await chain.startTest().catch((cause) => {
					chain.stopTest();
					failedMedia(cause, 'microphone');
				});
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
		/**
		 * Applies the mixer's per-rider gain live (#179, #463). One fader per
		 * rider, however many tabs they are connected from; a short ramp, so a
		 * dragged slider does not zipper.
		 */
		setRiderGain(id: string, v: number, name?: string) {
			mixer.setRiderGain(id, v, name);
			output.applyGains();
		},
		join,
		async toggleMic() {
			if (!room) return;
			if (chain.testing) chain.stopTest();
			// Pressing the mic in a tab that stood down means "bring it here",
			// not "publish a second one" — the rail says the mic lives in
			// another tab, and the button must not quietly contradict it.
			if (handedOff) {
				await takeOver();
				return;
			}
			if (micOn) {
				chain.close();
				micOn = false;
			} else {
				await tryOpenMic();
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
					liveKit!.Track.Source.ScreenShare,
				)?.videoTrack;
				if (sharing && track) {
					screenTracks.set(me, { owner: myIdentity, track });
					stage.addScreen(me);
				} else {
					sharing = false;
					if (dropOwned(screenTracks, me, myIdentity)) stage.dropScreen(me);
				}
			} catch (cause) {
				sharing = false;
				failedMedia(cause, 'screen');
			}
		},
		/** Everything the stage can show, screens first (#280). */
		get stageSources() {
			return stage.sources;
		},
		/** The rider's pick. The room page resolves it against the full list —
		 *  longer than ours, the jukebox video is on it too (#316). */
		get stagePick() {
			return stage.pick;
		},
		/** Pick a source, or null to follow the newest share again. */
		setStage(key: string | null) {
			stage.setPick(key);
		},
		/** The stage surface: a screen is a document (contain), a face isn't.
		 *  A key we do not know is not ours to draw — the jukebox seats itself. */
		attachStage(container: HTMLElement, key: string) {
			const source = stage.sources.find((candidate) => candidate.key === key);
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
			if (room && liveKit) {
				for (const kind of [
					liveKit.Track.Source.Camera,
					liveKit.Track.Source.ScreenShare,
				]) {
					const pub = room.localParticipant.getTrackPublication(kind);
					pub?.videoTrack?.mediaStreamTrack?.stop();
				}
			}
			chain.close();
			void room?.disconnect();
			room = null;
			status = 'off';
			error = null;
			micOn = camOn = sharing = away = false;
			chain.clearFault();
			// The room is behind you: its mute goes with it, or the next
			// room — and every cue outside one — starts silent.
			mixer.setMuted(false);
			voice = {};
			talk.clear();
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
			output.close();
		},
	};
}
