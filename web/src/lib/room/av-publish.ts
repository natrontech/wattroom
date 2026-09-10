import type { AvConn, AvState } from '$lib/room/av-state.svelte';
import { rememberShareSound } from '$lib/room/av-state.svelte';
import type { Seats } from '$lib/room/av-seats';
import type { Stage } from '$lib/room/av-stage.svelte';
import type { RiderOutput } from '$lib/room/av-output';
import type { MicChain } from '$lib/room/mic-chain.svelte';
import type { MediaDevice } from '$lib/room/media-error';
import { mixer } from '$lib/sound/mixer.svelte';

/**
 * What this machine puts into the room, and what stepping out takes back down
 * (#1698).
 *
 * The camera and the screen are one concept and the mic is not: LiveKit owns
 * both of these captures (`setCameraEnabled`, `setScreenShareEnabled`), while
 * the microphone is captured and processed here and only handed over as a
 * finished track — `mic-chain.svelte.ts`. What they share is the rule every
 * function below is written around: **trust the publication, not the intent.**
 * A device the browser refuses would otherwise leave `camOn` or `sharing`
 * lying, and a tile draws a frame that never arrives.
 *
 * Away lives here because it is these three held down together (#706): a
 * rider who stepped out is not talking, not on camera, and — since #1128 —
 * not showing the room their screen either.
 */
export interface PublishHost {
	av: AvState;
	conn: AvConn;
	seats: Seats;
	stage: Stage;
	output: RiderOutput;
	chain: MicChain;
	/** Record a device the browser refused; a closed share picker says nothing. */
	failedMedia(cause: unknown, device: MediaDevice): void;
	/** Who is in voice and whether their mic is open (#151). */
	setVoice(id: string, state: 'live' | 'muted' | null): void;
	/** Open the mic and let `micOn` say what actually happened. */
	tryOpenMic(): Promise<void>;
	/** Restamp the "I was in voice here" note (#480). */
	noteVoice(): void;
}

export type Publish = ReturnType<typeof createPublish>;

export function createPublish(host: PublishHost) {
	const {
		av,
		conn,
		seats,
		stage,
		output,
		chain,
		failedMedia,
		setVoice,
		tryOpenMic,
		noteVoice,
	} = host;

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
				seats.set('video', conn.me, { owner: conn.myIdentity, track });
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
		if (seats.drop('video', conn.me, conn.myIdentity)) stage.dropVideo(conn.me);
	}

	/**
	 * Switch camera mid-ride. Told to LiveKit whether or not the camera is on
	 * (#1876): it keeps the pick as the capture default for the next open, and
	 * the picker is reached with the camera off far more often than on. The
	 * empty id is "the browser's default", which as an exact constraint
	 * matches nothing — so not exact.
	 */
	async function switchCam(id: string) {
		if (!conn.room) return;
		try {
			await conn.room.switchActiveDevice('videoinput', id, id !== '');
		} catch (cause) {
			// Another app holding it, an unplugged USB cam, a revoked
			// permission: the mic path says why (#824), this one was silent
			// (#1880). Trust the publication for whether a picture survives.
			failedMedia(cause, 'camera');
			if (
				av.camOn &&
				!conn.room.localParticipant.getTrackPublication(
					conn.liveKit!.Track.Source.Camera,
				)?.videoTrack
			)
				av.camOn = false;
		}
	}

	/**
	 * Put a screen on the stage, with the machine's sound if the rider wants
	 * it (#1751). Asking for no audio at all rather than publishing it muted:
	 * the loopback tap is the whole machine — their notifications, their calls
	 * — and a tap that is open but silent is still a tap.
	 */
	async function startShare() {
		if (!conn.room) return;
		av.sharing = true;
		try {
			// The browser's picker can be cancelled — trust the publication,
			// not our intent.
			// The machine's audio rides along with the picture (#1124). Its
			// profile is ADR-0011's "music", not "voice": processing off,
			// because noise suppression and AGC are tuned for a person
			// talking and wreck anything else. LiveKit publishes it as its
			// own ScreenShareAudio track; nothing here has to.
			await conn.room.localParticipant.setScreenShareEnabled(true, {
				audio: av.shareSound && {
					autoGainControl: false,
					echoCancellation: false,
					noiseSuppression: false,
				},
			});
			const track = conn.room.localParticipant.getTrackPublication(
				conn.liveKit!.Track.Source.ScreenShare,
			)?.videoTrack;
			if (!track) {
				av.sharing = false;
				av.sharingAudio = false;
				if (seats.drop('screen', conn.me, conn.myIdentity))
					stage.dropScreen(conn.me);
				return;
			}
			seats.set('screen', conn.me, { owner: conn.myIdentity, track });
			stage.addScreen(conn.me);
			// Whether the machine's sound went with the picture. Read
			// from the publication rather than assumed from asking:
			// loopback is refused, missing or dead on plenty of
			// platforms, and telling a rider the room can hear them
			// when it cannot is the worse half of getting this wrong.
			av.sharingAudio = !!conn.room.localParticipant.getTrackPublication(
				conn.liveKit!.Track.Source.ScreenShareAudio,
			);
		} catch (cause) {
			av.sharing = false;
			av.sharingAudio = false;
			failedMedia(cause, 'screen');
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
		if (seats.drop('screen', conn.me, conn.myIdentity))
			stage.dropScreen(conn.me);
	}

	/**
	 * Whether the room hears this machine as well as seeing it (#1751), and
	 * the answer is remembered — the report was that every share started loud.
	 *
	 * Off is instant and closes the tap: a rider who meant "not this" does not
	 * wait on a picker to say it. On has to re-run the share, picker and all,
	 * because `getDisplayMedia` has no audio-only form — the sound cannot be
	 * added to a capture that did not take it.
	 */
	async function setShareSound(on: boolean) {
		if (on === av.shareSound) return;
		av.shareSound = on;
		rememberShareSound(on);
		if (!av.sharing || !conn.room || !conn.liveKit) return;
		if (on) {
			await stopShare();
			await startShare();
			return;
		}
		const track = conn.room.localParticipant.getTrackPublication(
			conn.liveKit.Track.Source.ScreenShareAudio,
		)?.audioTrack;
		// `true` stops the underlying MediaStreamTrack: unpublishing alone
		// leaves the machine tapped, which is the same shape of bug the camera
		// had in closeCam above.
		if (track)
			await conn.room.localParticipant
				.unpublishTrack(track, true)
				.catch(() => {});
		av.sharingAudio = false;
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

	return {
		openCam,
		closeCam,
		switchCam,
		startShare,
		stopShare,
		setShareSound,
		setAway,
		/** The button: whichever of the two the rider is not doing (#1128). */
		toggleShare() {
			return av.sharing ? stopShare() : startShare();
		},
		async toggleCam() {
			if (!conn.room) return;
			if (av.camOn) {
				await closeCam();
				return;
			}
			await openCam();
		},
	};
}
