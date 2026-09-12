import type {
	Room as LiveKitRoom,
	Track as LiveKitTrack,
	TrackPublication as LiveKitPublication,
} from 'livekit-client';
import type { ClaimantSource, LiveKitClient } from '$lib/room/av-types';
import type { AvConn, AvState } from '$lib/room/av-state.svelte';
import { type Seats, audioKey } from '$lib/room/av-seats';
import type { Stage } from '$lib/room/av-stage.svelte';
import type { RiderOutput } from '$lib/room/av-output';
import type { Speaking } from '$lib/room/speaking';
import type { Claims } from '$lib/room/av-claim.svelte';
import type { MicChain } from '$lib/room/mic-chain.svelte';
import { riderOf, yieldsTo } from '$lib/room/tabs';

/**
 * Everything LiveKit tells us, translated onto the room (#1698).
 *
 * The fifth seam out of `av.svelte.ts`, and the one #892 declined to take:
 * "extracting `wire()` would mean declaring nearly this whole closure as an
 * interface". What actually stopped it is written down in
 * `av-state.svelte.ts` — this code ASSIGNS seven reactive bindings, and an
 * imported `let` cannot be assigned. #892 itself dissolved that by making
 * every one of them a field of the `$state` object `createAvState()` returns:
 * fields can be written from any scope holding the object and stay reactive.
 * What is left is not the closure but its parts, which is what `WireHost` is
 * — the same shape `ClaimHost` and `MicChainHost` already have.
 *
 * The SDK stops here, on the way in. Nothing downstream of this file knows
 * what a `TrackPublication` is: seats, the stage, the claim protocol and the
 * speaking meter are all told in the room's own vocabulary.
 */
export interface WireHost {
	av: AvState;
	conn: AvConn;
	seats: Seats;
	stage: Stage;
	output: RiderOutput;
	/** Who is talking, measured off the voice on its way out (#987). */
	talk: Speaking;
	/** Which tab holds the mic (#293). */
	claims: Claims;
	/** This machine's microphone — a disconnect takes its publication. */
	chain: MicChain;
	/** Who is in voice and whether their mic is open (#151). */
	setVoice(id: string, state: 'live' | 'muted' | null): void;
	/** A participant as the claim protocol sees it — no SDK past that line. */
	claimantOf(p: ClaimantSource): Parameters<Claims['consider']>[0];
	/** Take the mic and camera back into this tab; the others stand down. */
	takeOver(opts?: { reopenMic?: boolean }): Promise<void>;
	/** Stop restamping the "I was in voice here" note (#480). */
	stopNote(): void;
}

export function wireRoom(
	r: LiveKitRoom,
	client: LiveKitClient,
	host: WireHost,
): void {
	const {
		av,
		conn,
		seats,
		stage,
		output,
		talk,
		claims,
		chain,
		setVoice,
		claimantOf,
		takeOver,
		stopNote,
	} = host;

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
				seats.set('screen', rider, owned);
				if (!pub.isMuted) stage.addScreen(rider);
			} else {
				seats.set('video', rider, owned);
				if (!pub.isMuted) stage.bumpVideo(rider);
			}
		}
		if (track.kind === client.Track.Kind.Audio) {
			// A rider can publish TWO audio tracks — their voice and their
			// machine (#1124) — so the elements are keyed by source as well as
			// identity. Keyed by identity alone, the second arrival replaced
			// the first: sharing your screen took your voice off everyone's
			// speakers, with nothing anywhere saying so.
			const share = pub.source === client.Track.Source.ScreenShareAudio;
			const key = audioKey(participant.identity, share);
			const el = track.attach() as HTMLAudioElement;
			seats.audio.set(key, el);
			document.body.appendChild(el);
			output.route(key, el, share);
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
				if (seats.drop('screen', rider, participant.identity))
					stage.dropScreen(rider);
			} else if (seats.drop('video', rider, participant.identity)) {
				stage.dropVideo(rider);
			}
		}
		if (track.kind === client.Track.Kind.Audio) {
			const key = audioKey(
				participant.identity,
				pub.source === client.Track.Source.ScreenShareAudio,
			);
			track.detach().forEach((el) => el.remove());
			seats.audio.delete(key);
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
		// The sound went with the picture (#1881): left true, the next
		// share's notice claimed the machine's sound while the picker was
		// still open.
		av.sharingAudio = false;
		if (seats.drop('screen', conn.me, conn.myIdentity))
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
		claims.consider(claimantOf(p));
	});
	// The SFU's verdict on a participant's link (#2131). It arrives for every
	// participant including this one, which is why the roster can show one
	// rider what another rider's connection is doing: the number is the
	// server's, not something the other browser claimed about itself.
	r.on(client.RoomEvent.ConnectionQualityChanged, (quality, p) => {
		if (!p) return;
		av.quality = { ...av.quality, [riderOf(p.identity)]: quality };
	});
	r.on(client.RoomEvent.ParticipantDisconnected, (p) => {
		const rider = riderOf(p.identity);
		// Their other tab may still be publishing, and a tier left behind by
		// the tab that went would outlive the only media it described.
		if (!claims.stillHere(rider, p.identity)) {
			const { [rider]: _gone, ...rest } = av.quality;
			av.quality = rest;
		}
		// Belt and braces: TrackUnsubscribed normally arrives first and takes
		// the meter with it, but a connection dropped hard may skip it.
		if (talk.drop(p.identity)) av.speaking = { ...talk.riders };
		// Their other tab may still be in the room — one closed tab does not
		// take a rider out of voice (#293).
		if (!claims.stillHere(rider, p.identity)) setVoice(rider, null);
		// The tab that took the mic is gone: this one may have it back, and
		// it goes back the way it left, without asking (ux.md: recovery is
		// automatic where it can be).
		// Not during a full reconnect (#1878): the SDK unwinds every remote
		// first, so the tab holding the mic looks gone for a moment and a
		// background tab would take it — with a newer claim, so the tab
		// the rider is looking at then stands down. Reconnected re-asks.
		if (
			av.handedOff &&
			av.status !== 'reconnecting' &&
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
		if (!seats.owns(screen ? 'screen' : 'video', rider, p.identity)) return;
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
		// The roster is back: if the tab that held the mic really went
		// while the link was down, this one has it back now (#1878).
		if (av.handedOff && !claims.stillHere(conn.me, conn.myIdentity))
			void takeOver({ reopenMic: claims.micBeforeHandoff });
	});
	r.on(client.RoomEvent.Disconnected, () => {
		const unexpected = av.status === 'live' || av.status === 'reconnecting';
		seats.clear();
		stage.clear();
		av.voice = {};
		// Nobody's link is being judged in a room we left; a tier kept here
		// would sit on the roster claiming to be live (#2131).
		av.quality = {};
		// Nobody is talking to a room you are no longer in — a stale
		// speaking flag parked music and cues at duck level forever, and
		// camOn, sharing and micOn all lied about dead tracks (#219, #354).
		talk.clear();
		av.speaking = {};
		av.camOn = false;
		conn.micBeforeDrop = av.micOn;
		av.micOn = false;
		av.sharing = false;
		av.sharingAudio = false;
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
