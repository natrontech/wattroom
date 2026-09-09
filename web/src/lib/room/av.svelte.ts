import type {
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
import { createAvConn, createAvState } from '$lib/room/av-state.svelte';
import type { LiveKitClient, Owned } from '$lib/room/av-types';

export type { AvError, AvStatus } from '$lib/room/av-types';
import { type MediaDevice, describeMediaError } from '$lib/room/media-error';
import { serverNow } from '$lib/room/server-clock';
import { createClaims } from '$lib/room/av-claim.svelte';
import { createMicChain } from '$lib/room/mic-chain.svelte';
import { mountTrack } from '$lib/room/mount-track';
import { riderOf, yieldsTo } from '$lib/room/tabs';
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
 * Mic starts on with browser echoCancellation + autoGainControl and no noise
 * suppression (SPEC room audio defaults, ADR-0043); camera starts off. Track ownership: LiveKit owns the media
 * elements' streams, this store owns attachment points keyed by rider id so
 * the dashboard can put faces on the tiles it already has.
 *
 * ON THE LENGTH. This file is over code-quality.md's ~300-line ceiling and is
 * meant to be: what is left after #892 took out four seams (device choices,
 * the rider-audio bus, the mic chain, the claim protocol) is the AV lifecycle
 * itself — join/leave, the LiveKit event surface, and the store's public API,
 * which is a third of the file and is surface rather than logic.
 *
 * #892 was written against "one mutable scope wide enough that a cross-wired
 * bug looks local", and that condition is gone: the gate, the fault, the
 * claim protocol and the device choices each have their own scope and their
 * own tests now, none of which need a livekit-client mock. The line count did
 * not fall much and is not the thing to fix. Extracting `wire()` would mean
 * declaring nearly this whole closure as an interface — the same coupling
 * written down twice — so don't, unless a bug shows the coupling actually
 * costs something. Closed on those terms 2026-09-08.
 */

/**
 * Why the last thing the rider asked of voice did not happen (#642). Not a
 * toast: a rider on a bike reads it a minute later, mid-interval, so the
 * sidebar keeps it until the next attempt clears it. `signIn` marks the one
 * failure whose remedy is a page, not a retry.
 */

const VOICE_UNREACHABLE =
	'Voice could not connect — check your connection and try again.';
/**
 * A join that neither connects nor fails (#1203): a browser that never
 * delivers the gesture the SDK is waiting for, a webview, a network that
 * swallows the handshake. LiveKit bounds its own peer connection, but the
 * whole attempt was not bounded, so "joining voice…" could sit there for the
 * rest of the ride with nothing telling the rider or the code. Long enough
 * for a slow handshake on a bad link, short enough that a rider mid-warmup
 * gets a button back.
 */
export const JOIN_TIMEOUT_MS = 20_000;
const VOICE_STUCK =
	'Voice did not connect in time — try again, and tap or click anywhere first if the browser is waiting for you.';

export function createRoomAv(slug: string) {
	// One named place for what the UI watches, one for what the connection
	// keeps to itself (#892) — av-state.svelte.ts says why they are two. It
	// was named to make a further split possible; see the note above for why
	// that split is deliberately not being taken.
	const av = createAvState();
	const conn = createAvConn();
	/** Record a device the browser refused; a closed share picker says nothing. */
	function failedMedia(cause: unknown, device: MediaDevice) {
		const message = describeMediaError(cause, device);
		if (message) av.error = { message, signIn: false };
	}
	const stage = createStage();

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
				av.speaking = { ...talk.riders };
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
	async function tryOpenMic() {
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

	function setVoice(id: string, state: 'live' | 'muted' | null) {
		const next = { ...av.voice };
		if (state === null) delete next[id];
		else next[id] = state;
		av.voice = next;
	}

	/** This connection's identity and the rider behind it (#293). */
	/**
	 * Video is keyed by RIDER — the tiles and the stage are — but tagged with
	 * the connection that published it: when a rider's older tab drops its
	 * camera, it must not delete the track their newer tab just put up.
	 */
	const videoTracks = new Map<string, Owned>();
	const screenTracks = new Map<string, Owned>();
	/** Audio plumbing is per CONNECTION: one element and one gain each. */
	const audioElements = new Map<string, HTMLAudioElement>();
	/**
	 * A rider's voice and a rider's shared machine are two audio tracks from
	 * one identity, so anything holding them per rider needs both halves of
	 * the name (#1124). The suffix, not a separate map: every caller here
	 * already has the publication's source in hand.
	 */
	function audioKey(
		identity: string,
		source: unknown,
		lk: { Track: { Source: { ScreenShareAudio: unknown } } },
	) {
		return source === lk.Track.Source.ScreenShareAudio
			? identity + ' \u2014 share'
			: identity;
	}
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
	 * Let the room be heard: resume the graph and tell LiveKit to start the
	 * elements (#645).
	 *
	 * Both halves are needed and neither is enough. `startAudio` plays the
	 * media elements, but their sound reaches the speakers only through the
	 * bus (av-output.ts holds them at volume 0 — `startAudio` unmutes them,
	 * #1339) — so a suspended context is silence whatever LiveKit does. And
	 * resuming the context does not play an element the browser refused.
	 */
	async function startPlayback() {
		chain.resume();
		output.resume();
		try {
			await conn.room?.startAudio();
		} catch {
			// Still no gesture the browser will accept: the strip stays up,
			// which is the whole point of it being status rather than a toast.
		}
		if (conn.room) av.playbackBlocked = !conn.room.canPlaybackAudio;
	}

	/**
	 * Any click, anywhere, is a gesture the browser will accept — so most
	 * riders never see the strip at all. `once` because the graph only needs
	 * unblocking once, and a listener on every pointerdown for the life of a
	 * room is not worth the one it catches.
	 */
	function onFirstGesture() {
		void startPlayback();
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
		document.addEventListener('pointerdown', onFirstGesture, { once: true });
		navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
	}
	listen();

	// ── "I was in voice here" (#480) ─────────────────────────────────────────
	// A refresh kills the page and the LiveKit room with it. The note this
	// tab leaves behind is what lets the next page walk back in; it is
	// restamped while the call is live, so an hour of riding still reads as a
	// refresh, and torn up the moment the rider hangs up.
	const tab = tabId();
	function noteVoice() {
		writeNote(tab, { slug, at: Date.now(), mic: av.micOn });
	}
	function startNote() {
		noteVoice();
		conn.heartbeat ??= setInterval(noteVoice, REJOIN_HEARTBEAT_MS);
	}
	function stopNote() {
		if (conn.heartbeat !== null) clearInterval(conn.heartbeat);
		conn.heartbeat = null;
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
			av.status === 'connecting' ||
			av.status === 'live' ||
			av.status === 'reconnecting'
		)
			return;
		void conn.room?.disconnect();
		av.status = 'connecting';
		av.error = null;
		// A fault from a previous call, or from a mic test that died, is not
		// this join's — it surfaced as "your microphone stopped" on a
		// listen-only join that never opened one (#824).
		chain.clearFault();
		listen();
		// The attempt is bounded as a whole (#1203). When the deadline lands
		// first the rider gets the failed state and its retry; whatever the
		// stuck step resolves to afterwards finds the join no longer
		// connecting and stands down. Anything else that moves the status
		// meanwhile — leave(), say — is the same signal.
		const stale = () => av.status !== 'connecting';
		const deadline = setTimeout(() => {
			if (stale()) return;
			av.status = 'failed';
			av.error = { message: VOICE_STUCK, signIn: false };
			void conn.room?.disconnect();
		}, JOIN_TIMEOUT_MS);
		try {
			await joinAttempt(wantMic, stale);
		} finally {
			clearTimeout(deadline);
		}
	}

	async function joinAttempt(wantMic: boolean, stale: () => boolean) {
		const res = await api<{ url: string; token: string }>(
			`/api/rooms/${slug}/av-token`,
		);
		if (stale()) return;
		if (!res.ok) {
			av.status = 'failed';
			// 401 is the one refusal a retry cannot fix (#642).
			av.error = {
				message: res.error.message,
				signIn: res.error.error === 'unauthorized',
			};
			return;
		}
		try {
			const client = await import('livekit-client');
			conn.liveKit = client;
			// No audioCaptureDefaults: this room never opens the mic through
			// LiveKit. captureMic() does, with MIC_CONSTRAINTS (room/capture),
			// and publishes the processed track — so a second copy here could
			// only ever be a second source of truth that never takes effect,
			// and this one was already missing autoGainControl (#671). Video
			// IS LiveKit's own capture (setCameraEnabled), so its defaults
			// stay.
			conn.room = new client.Room({
				// Both ship OFF, and neither was ever turned on (#669).
				//
				// adaptiveStream: without it every subscribed camera arrives at
				// the publisher's full layer whatever it lands in — and what it
				// lands in here is a 96 px tile, with at most one source on the
				// stage. It also keeps video flowing into a hidden tab. The
				// precondition is one element per container, attached through
				// `track.attach()`, which `mount-track.ts` already does.
				//
				// dynacast: without it a publisher encodes and uploads simulcast
				// layers nobody has subscribed to. That is the rider's OWN
				// upstream — one household uplink, which is the link that gives
				// out first on a group ride.
				adaptiveStream: true,
				dynacast: true,
				...(devices.camId
					? { videoCaptureDefaults: { deviceId: devices.camId } }
					: {}),
			});
			wire(conn.room, client);
			await conn.room.connect(res.data.url, res.data.token);
			if (stale()) {
				// The deadline (or a leave) beat the handshake: do not walk into
				// a room the rider was already told did not open.
				void conn.room.disconnect();
				return;
			}
			conn.myIdentity = conn.room.localParticipant.identity;
			conn.me = riderOf(conn.myIdentity);
			av.status = 'live';
			claims.current = {
				identity: conn.room.localParticipant.identity,
				at: conn.room.localParticipant.joinedAt?.getTime() ?? Date.now(),
			};
			// A tab already in the room could, in principle, hold a newer claim
			// than this one — check rather than assume newest-connected wins.
			for (const p of conn.room.remoteParticipants.values())
				claims.consider(asClaimant(p));
			// Post-permission the labels are real — the pickers can name devices.
			void devices.refresh();
			// Mic on by default (SPEC); a denied permission downgrades to
			// listen-only rather than failing the join.
			for (const p of conn.room.remoteParticipants.values()) {
				const pub = p.getTrackPublication(
					conn.liveKit!.Track.Source.Microphone,
				);
				setVoice(riderOf(p.identity), pub && !pub.isMuted ? 'live' : 'muted');
			}
			// Away follows the rider across their screens (#706). A voice
			// reconnect or a second tab joining while the rider is away must not
			// quietly reopen a microphone the away button just closed.
			if (wantMic && !av.away) {
				await tryOpenMic();
				setVoice(conn.me, av.micOn ? 'live' : 'muted');
			} else {
				av.micOn = false;
				setVoice(conn.me, 'muted');
			}
			startNote();
		} catch {
			if (stale()) return;
			// LiveKit's own message is written for developers; the rider needs
			// the step that failed and the one thing to try (errors.md).
			av.status = 'failed';
			av.error = { message: VOICE_UNREACHABLE, signIn: false };
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
	/**
	 * Whether the mic was open when LiveKit dropped us, for the rejoin (#641).
	 * The Disconnected handler clears `micOn` before the rejoin fires, and a
	 * rider who muted for a phone call must not come back publishing.
	 */

	// One rider, several tabs (#293): which one holds the mic, and what a tab
	// standing down has to put down. The protocol is av-claim.svelte.ts; this
	// hands it the connection.
	const claims = createClaims({
		identity: () => conn.myIdentity,
		now: () => serverNow(),
		participants: () =>
			conn.room
				? [
						conn.room.localParticipant,
						...conn.room.remoteParticipants.values(),
					].map(asClaimant)
				: [],
		others: () =>
			conn.room
				? [...conn.room.remoteParticipants.values()].map(asClaimant)
				: [],
		announce: (at) => {
			void conn.room?.localParticipant
				.publishData(
					new TextEncoder().encode(JSON.stringify({ t: 'av-claim', at })),
					{ reliable: true },
				)
				.catch(() => {});
		},
		handedOff: () => av.handedOff,
		setHandedOff: (next) => (av.handedOff = next),
		micOn: () => av.micOn,
		closeMic: () => {
			chain.close();
			av.micOn = false;
		},
		clearFault: () => chain.clearFault(),
		closeCam: () => closeCam(),
		noteVoice: () => noteVoice(),
	});

	/** A participant as the claim protocol sees it — no SDK past this line. */
	function asClaimant(p: {
		identity: string;
		joinedAt?: Date;
		getTrackPublication: (
			source: LiveKitTrack.Source,
		) => { isMuted: boolean } | undefined;
	}) {
		const pub = p.getTrackPublication(conn.liveKit!.Track.Source.Microphone);
		return {
			identity: p.identity,
			joinedAt: p.joinedAt,
			micOpen: !!pub && !pub.isMuted,
		};
	}

	/** Take the mic and camera back into this tab; the others stand down. */
	async function takeOver({ reopenMic = true } = {}) {
		if (!conn.room) return;
		claims.claim();
		if (reopenMic && !av.micOn) {
			await tryOpenMic();
			setVoice(conn.me, av.micOn ? 'live' : 'muted');
		}
		noteVoice();
	}

	/**
	 * Publish the camera. Trust the publication rather than the intent: a
	 * device the browser refuses would otherwise leave camOn lying, and the
	 * tile draws a frame that never arrives.
	 */
	async function openCam() {
		if (av.camOn || !conn.room) return;
		av.camOn = true;
		try {
			await conn.room.localParticipant.setCameraEnabled(true);
			const track = conn.room.localParticipant.getTrackPublication(
				conn.liveKit!.Track.Source.Camera,
			)?.videoTrack;
			if (track) {
				videoTracks.set(conn.me, { owner: conn.myIdentity, track });
				stage.bumpVideo(conn.me);
			} else {
				await closeCam();
			}
		} catch (cause) {
			av.camOn = false;
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
		if (next === av.away) return;
		av.away = next;
		// Stepping out silences the speakers too (#875): voices, the jukebox
		// and the cues all play to an empty chair otherwise. The faders keep
		// their values, so coming back restores the mix and not a default.
		mixer.setMuted(next);
		output.applyGains();
		// A rider can step away without joining voice. Keep the state so a
		// later voice join stays listen-only; there is no capture to change yet.
		if (!conn.room) return;
		if (av.away) {
			conn.micBeforeAway = av.micOn;
			conn.camBeforeAway = av.camOn;
			// Stepping away is the rider closing the mic, not losing it.
			chain.clearFault();
			if (av.micOn) {
				chain.close();
				av.micOn = false;
			}
			setVoice(conn.me, 'muted');
			noteVoice();
			await closeCam();
			// And the screen goes with them (#1128). A rider who stepped out is
			// not watching what their machine is showing the room, which is the
			// same argument as the camera's — and one step worse, because a
			// screen keeps disclosing after they walk off (#563).
			//
			// Deliberately NOT restored on return, unlike the mic and camera:
			// those come back to what this tab had live, and a share is a thing
			// the rider pointed at something. Re-publishing a window they left
			// ten minutes ago, without them asking, is how a private tab
			// reaches a room. Coming back offers the button, not the share.
			if (av.sharing) await stopShare();
			return;
		}
		if (conn.micBeforeAway && !av.micOn) {
			await tryOpenMic();
			setVoice(conn.me, av.micOn ? 'live' : 'muted');
			noteVoice();
		}
		if (conn.camBeforeAway && !av.camOn) {
			await openCam();
		}
	}

	/**
	 * Stop sharing, whoever asked — the button, or stepping away (#1128).
	 * One place, so the two cannot drift apart on what stopping means.
	 */
	async function stopShare() {
		if (!conn.room) return;
		av.sharing = false;
		av.sharingAudio = false;
		await conn.room.localParticipant
			.setScreenShareEnabled(false)
			.catch(() => {});
		if (dropOwned(screenTracks, conn.me, conn.myIdentity))
			stage.dropScreen(conn.me);
	}

	/**
	 * Put the camera down and hand the device back to the machine. Three
	 * callers now (the button, a handoff, stepping away in #706), and
	 * unpublishing alone is not enough: it can leave the capture open, and
	 * then the camera reads as "in use" to every other tab and app until the
	 * page closes (rider report: the camera stopped working in Chrome).
	 */
	async function closeCam() {
		if (!av.camOn || !conn.room) return;
		av.camOn = false;
		const track = conn.room.localParticipant.getTrackPublication(
			conn.liveKit!.Track.Source.Camera,
		)?.videoTrack;
		await conn.room.localParticipant.setCameraEnabled(false).catch(() => {});
		track?.mediaStreamTrack?.stop();
		if (dropOwned(videoTracks, conn.me, conn.myIdentity))
			stage.dropVideo(conn.me);
	}

	function wire(r: LiveKitRoom, client: LiveKitClient) {
		// Only an explicit takeover arrives this way. The sender must be a
		// participant we know — an unattributed packet is not something to
		// mute a rider's microphone over.
		r.on(client.RoomEvent.DataReceived, (payload, participant) => {
			if (!participant || !claims.current) return;
			let at: unknown;
			try {
				const msg = JSON.parse(new TextDecoder().decode(payload));
				if (msg?.t !== 'av-claim') return;
				at = msg.at;
			} catch {
				return; // not ours to read
			}
			if (typeof at !== 'number') return;
			if (yieldsTo(claims.current, { identity: participant.identity, at }))
				void claims.standDown();
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
				// A rider can publish TWO audio tracks — their voice and their
				// machine (#1124) — so both maps are keyed by source as well as
				// identity. Keyed by identity alone, the second arrival replaced
				// the first: sharing your screen took your voice off everyone's
				// speakers, with nothing anywhere saying so.
				const key = audioKey(participant.identity, pub.source, client);
				const el = track.attach() as HTMLAudioElement;
				audioElements.set(key, el);
				document.body.appendChild(el);
				output.route(
					key,
					el,
					pub.source === client.Track.Source.ScreenShareAudio,
				);
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
				const key = audioKey(participant.identity, pub.source, client);
				track.detach().forEach((el) => el.remove());
				audioElements.delete(key);
				output.drop(key);
				// The meter went with the track, so nothing can report this
				// voice again — and a flag nothing will ever clear is what
				// left riders ringed forever (#987).
				if (talk.drop(participant.identity)) av.speaking = { ...talk.riders };
				if (
					pub.source === client.Track.Source.Microphone &&
					!claims.micLive(rider, participant.identity)
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
			av.sharing = false;
			if (dropOwned(screenTracks, conn.me, conn.myIdentity))
				stage.dropScreen(conn.me);
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
			claims.consider(asClaimant(p));
		});
		r.on(client.RoomEvent.ParticipantDisconnected, (p) => {
			const rider = riderOf(p.identity);
			// Belt and braces: TrackUnsubscribed normally arrives first and takes
			// the meter with it, but a connection dropped hard may skip it.
			if (talk.drop(p.identity)) av.speaking = { ...talk.riders };
			// Their other tab may still be in the room — one closed tab does not
			// take a rider out of voice (#293).
			if (!claims.stillHere(rider, p.identity)) setVoice(rider, null);
			// The tab that took the mic is gone: this one may have it back, and
			// it goes back the way it left, without asking (ux.md: recovery is
			// automatic where it can be).
			if (
				av.handedOff &&
				rider === conn.me &&
				!claims.stillHere(conn.me, conn.myIdentity)
			)
				void takeOver({ reopenMic: claims.micBeforeHandoff });
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
			if (
				pub.kind === client.Track.Kind.Audio &&
				!claims.micLive(rider, p.identity)
			)
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
		// The browser refused to start audio with no gesture behind it (#645).
		// LiveKit has an event for exactly this; nothing was listening, so the
		// room simply went quiet with nothing to press.
		r.on(client.RoomEvent.AudioPlaybackStatusChanged, () => {
			av.playbackBlocked = !r.canPlaybackAudio;
		});
		// And the state as it already stands: a rejoin that never gets a
		// gesture (the #480 refresh, the #219 drop-rejoin) is blocked from the
		// start, and no change event follows to say so.
		av.playbackBlocked = !r.canPlaybackAudio;
		r.on(client.RoomEvent.Reconnecting, () => {
			if (av.status === 'live') av.status = 'reconnecting';
		});
		r.on(client.RoomEvent.Reconnected, () => {
			if (av.status === 'reconnecting') av.status = 'live';
		});
		r.on(client.RoomEvent.Disconnected, () => {
			const unexpected = av.status === 'live' || av.status === 'reconnecting';
			for (const el of audioElements.values()) el.remove();
			audioElements.clear();
			videoTracks.clear();
			screenTracks.clear();
			stage.clear();
			av.voice = {};
			// Nobody is talking to a room you are no longer in — a stale
			// speaking flag parked music and cues at duck level forever, and
			// camOn, sharing and micOn all lied about dead tracks (#219, #354).
			talk.clear();
			av.speaking = {};
			av.camOn = false;
			conn.micBeforeDrop = av.micOn;
			av.micOn = false;
			av.sharing = false;
			av.handedOff = false;
			claims.current = null;
			conn.room = null;
			chain.close();
			if (unexpected) {
				// Stop restamping, but leave the note behind: a refresh during
				// the drop-rejoin window is still a refresh (#219, #480). Only
				// on an unexpected drop — a clean disconnect is either leave(),
				// which tears the note up itself, or join() clearing a stale
				// room, whose late event must not stop the heartbeat that join
				// is about to start.
				stopNote();
				av.status = 'off';
				av.dropped += 1;
			}
		});
	}

	return {
		get dropped() {
			return av.dropped;
		},
		/** What the drop-rejoin should do with the mic: what the rider had. */
		get micBeforeDrop() {
			return conn.micBeforeDrop;
		},
		get status() {
			return av.status;
		},
		get micOn() {
			return av.micOn;
		},
		get camOn() {
			return av.camOn;
		},
		/** Stepped out (#706) — the mic and camera are held down until back. */
		get away() {
			return av.away;
		},
		setAway,
		get sharing() {
			return av.sharing;
		},
		/** Whether the room can hear this machine as well as see it (#1124). */
		get sharingAudio() {
			return av.sharingAudio;
		},
		get error() {
			return av.error;
		},
		get videoOf() {
			return stage.videoOf;
		},
		get speaking() {
			return av.speaking;
		},
		get voice() {
			return av.voice;
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
		/** The browser muted this tab; one press fixes it (#645). */
		get playbackBlocked() {
			return av.playbackBlocked;
		},
		startPlayback,
		get handedOff() {
			return av.handedOff;
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
			if (!conn.room || av.handedOff || av.away) {
				chain.clearFault();
				return;
			}
			await tryOpenMic();
			setVoice(
				conn.me,
				av.micOn || claims.micLive(conn.me, conn.myIdentity) ? 'live' : 'muted',
			);
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
		async setCam(id: string) {
			devices.setCam(id);
			if (av.camOn && conn.room) {
				await conn.room.switchActiveDevice('videoinput', id).catch(() => {});
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
		/**
		 * The same, for whatever machine is being shared into the room
		 * (#1124). One fader for all of them: a rider is hearing one room, and
		 * two people sharing at once is not the case to build a mixer for.
		 */
		setShareGain(v: number) {
			mixer.setShare(v);
			output.applyGains();
		},
		join,
		async toggleMic() {
			if (!conn.room) return;
			if (chain.testing) chain.stopTest();
			// Pressing the mic in a tab that stood down means "bring it here",
			// not "publish a second one" — the rail says the mic lives in
			// another tab, and the button must not quietly contradict it.
			if (av.handedOff) {
				await takeOver();
				return;
			}
			if (av.micOn) {
				chain.close();
				av.micOn = false;
			} else {
				await tryOpenMic();
			}
			setVoice(
				conn.me,
				av.micOn || claims.micLive(conn.me, conn.myIdentity) ? 'live' : 'muted',
			);
			noteVoice();
		},
		async toggleCam() {
			if (!conn.room) return;
			if (av.camOn) {
				await closeCam();
				return;
			}
			await openCam();
		},
		async toggleShare() {
			if (!conn.room) return;
			av.sharing = !av.sharing;
			try {
				// The browser's picker can be cancelled — trust the publication,
				// not our intent.
				// The machine's audio rides along with the picture (#1124). Its
				// profile is ADR-0011's "music", not "voice": processing off,
				// because noise suppression and AGC are tuned for a person
				// talking and wreck anything else. LiveKit publishes it as its
				// own ScreenShareAudio track; nothing here has to.
				await conn.room.localParticipant.setScreenShareEnabled(av.sharing, {
					audio: {
						autoGainControl: false,
						echoCancellation: false,
						noiseSuppression: false,
					},
				});
				const track = conn.room.localParticipant.getTrackPublication(
					conn.liveKit!.Track.Source.ScreenShare,
				)?.videoTrack;
				if (av.sharing && track) {
					screenTracks.set(conn.me, { owner: conn.myIdentity, track });
					stage.addScreen(conn.me);
					// Whether the machine's sound went with the picture. Read
					// from the publication rather than assumed from asking:
					// loopback is refused, missing or dead on plenty of
					// platforms, and telling a rider the room can hear them
					// when it cannot is the worse half of getting this wrong.
					av.sharingAudio = !!conn.room.localParticipant.getTrackPublication(
						conn.liveKit!.Track.Source.ScreenShareAudio,
					);
				} else {
					av.sharing = false;
					av.sharingAudio = false;
					if (dropOwned(screenTracks, conn.me, conn.myIdentity))
						stage.dropScreen(conn.me);
				}
			} catch (cause) {
				av.sharing = false;
				av.sharingAudio = false;
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
			if (conn.room && conn.liveKit) {
				for (const kind of [
					conn.liveKit.Track.Source.Camera,
					conn.liveKit.Track.Source.ScreenShare,
				]) {
					const pub = conn.room.localParticipant.getTrackPublication(kind);
					pub?.videoTrack?.mediaStreamTrack?.stop();
				}
			}
			chain.close();
			void conn.room?.disconnect();
			conn.room = null;
			av.status = 'off';
			av.error = null;
			av.micOn = av.camOn = av.sharing = av.away = false;
			chain.clearFault();
			// The room is behind you: its mute goes with it, or the next
			// room — and every cue outside one — starts silent.
			mixer.setMuted(false);
			av.voice = {};
			talk.clear();
			av.speaking = {};
			// This av instance dies with the connection: audio graph and
			// listener go with it, or six room-hops exhaust the browser's
			// AudioContext budget (audit #219).
			if (typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', onVisible);
				document.removeEventListener('pointerdown', onFirstGesture);
				navigator.mediaDevices?.removeEventListener(
					'devicechange',
					onDeviceChange,
				);
			}
			output.close();
		},
	};
}
