import type {
	Room as LiveKitRoom,
	Track as LiveKitTrack,
} from 'livekit-client';
import { api } from '$lib/api';
import { mixer } from '$lib/sound/mixer.svelte';
import type { ClaimantSource, LiveKitClient } from '$lib/room/av-types';
import type { AvConn, AvState } from '$lib/room/av-state.svelte';
import type { DeviceChoices } from '$lib/room/av-devices.svelte';
import type { RiderOutput } from '$lib/room/av-output';
import type { Speaking } from '$lib/room/speaking';
import type { Claims } from '$lib/room/av-claim.svelte';
import type { MicChain } from '$lib/room/mic-chain.svelte';
import type { Listeners } from '$lib/room/av-listeners';
import type { NoteKeeper } from '$lib/room/rejoin';
import { riderOf } from '$lib/room/tabs';

/**
 * Getting into the room's call and back out of it (#21, #1698).
 *
 * The token comes from the server against the same membership check as the
 * metrics socket; AV is transit-only and never recorded (locked privacy
 * decision), so nothing here persists anything. What the connection does once
 * it is up is `av-wire.ts`; this is the two ends.
 *
 * Leaving is not the mirror image of joining and must not be written as one.
 * A join is allowed to find a stale room and clear it; a leave has to hand
 * every capture back to the machine, tear up the note that would rejoin, and
 * put the mixer back where a room-less page expects it.
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

export interface SessionHost {
	slug: string;
	av: AvState;
	conn: AvConn;
	devices: DeviceChoices;
	output: RiderOutput;
	/** Who is talking, measured off the voice on its way out (#987). */
	talk: Speaking;
	/** Which tab holds the mic (#293). */
	claims: Claims;
	chain: MicChain;
	listeners: Listeners;
	/** The "I was in voice here" note this tab leaves behind (#480). */
	note: NoteKeeper;
	/** Attach the LiveKit event surface, before the room connects. */
	wire(r: LiveKitRoom, client: LiveKitClient): void;
	/** A participant as the claim protocol sees it. */
	claimantOf(p: ClaimantSource): Parameters<Claims['consider']>[0];
	/** Open the mic and let `micOn` say what actually happened. */
	tryOpenMic(): Promise<void>;
	/** Who is in voice and whether their mic is open (#151). */
	setVoice(id: string, state: 'live' | 'muted' | null): void;
}

export type Session = ReturnType<typeof createSession>;

export function createSession(host: SessionHost) {
	const {
		slug,
		av,
		conn,
		devices,
		output,
		talk,
		claims,
		chain,
		listeners,
		note,
		wire,
		claimantOf,
		tryOpenMic,
		setVoice,
	} = host;

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
		listeners.listen();
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
				claims.consider(claimantOf(p));
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
			note.start();
		} catch {
			if (stale()) return;
			// LiveKit's own message is written for developers; the rider needs
			// the step that failed and the one thing to try (errors.md).
			av.status = 'failed';
			av.error = { message: VOICE_UNREACHABLE, signIn: false };
		}
	}

	function leave() {
		// Hanging up is the rider saying so: leaving and then reloading
		// must not drag them back in (#480).
		note.stop();
		note.clear();
		// Same for leaving: every local capture goes back to the machine.
		if (conn.room && conn.liveKit) {
			const local = conn.room.localParticipant;
			const kinds: LiveKitTrack.Source[] = [
				conn.liveKit.Track.Source.Camera,
				conn.liveKit.Track.Source.ScreenShare,
			];
			for (const kind of kinds)
				local.getTrackPublication(kind)?.videoTrack?.mediaStreamTrack?.stop();
		}
		chain.close();
		void conn.room?.disconnect();
		conn.room = null;
		av.status = 'off';
		av.error = null;
		av.micOn = av.camOn = av.sharing = av.away = false;
		// The hand-off and the blocked-playback strips are about a call
		// that is over (#1877); both offered a button that could do nothing.
		av.handedOff = av.playbackBlocked = av.sharingAudio = false;
		chain.clearFault();
		// The room is behind you: its mute goes with it, or the next
		// room — and every cue outside one — starts silent.
		mixer.setMuted(false);
		av.voice = {};
		talk.clear();
		av.speaking = {};
		// This av instance dies with the connection: audio graph and
		// listeners go with it, or six room-hops exhaust the browser's
		// AudioContext budget (audit #219).
		listeners.unlisten();
		output.close();
	}

	return { join, leave };
}
