import { deviceChoices } from '$lib/channel/av-devices.svelte';
import type { PlaceAddress } from '$lib/channel/address';
import { createStage } from '$lib/channel/av-stage.svelte';
import { createRiderOutput } from '$lib/channel/av-output';
import { createSpeaking } from '$lib/channel/speaking';
import { createAvConn, createAvState } from '$lib/channel/av-state.svelte';
import { createSeats } from '$lib/channel/av-seats';
import { createMic } from '$lib/channel/av-mic';
import { createPublish } from '$lib/channel/av-publish';
import { createTabs } from '$lib/channel/av-tabs';
import { createListeners } from '$lib/channel/av-listeners';
import { createSession } from '$lib/channel/av-session';
import { wireLiveKitRoom } from '$lib/channel/av-wire';
import { channelAvApi } from '$lib/channel/av-api';
import { type MediaDevice, describeMediaError } from '$lib/channel/media-error';
import { createNoteKeeper } from '$lib/channel/rejoin';
import { riderOf } from '$lib/channel/tabs';

export type { AvError, AvStatus } from '$lib/channel/av-types';
export { JOIN_TIMEOUT_MS } from '$lib/channel/av-session';

/**
 * The room's call (#21): LiveKit voice + camera + screenshare, joined with a
 * token the server mints against the same membership check as the metrics
 * socket. AV is transit-only and never recorded (locked privacy decision) —
 * nothing here persists anything.
 *
 * Mic starts on with browser echoCancellation + autoGainControl and no noise
 * suppression (SPEC room audio defaults, ADR-0043); camera starts off. Track
 * ownership: LiveKit owns the media elements' streams, `av-seats.ts` owns the
 * attachment points keyed by rider id so the dashboard can put faces on the
 * tiles it already has.
 *
 * This file assembles the parts and hands them to each other; the behaviour
 * is all in them. Where to look:
 *
 * - `av-state.svelte.ts` — what the UI watches, and what the connection keeps
 * - `av-session.ts` — joining and leaving, and the bounded attempt (#1203)
 * - `av-wire.ts` — everything LiveKit tells us, translated onto the room
 * - `av-mic.ts` — this tab's microphone, wired to this tab's connection
 * - `av-publish.ts` — the camera, the screen, and stepping away from both
 * - `av-tabs.ts` — which of the rider's tabs holds the mic (#293)
 * - `av-seats.ts` — who is in which seat, and which connection put them there
 * - `av-listeners.ts` — the machine's own events: suspension, autoplay, unplug
 * - `av-api.ts` — the flat surface the room page reads
 *
 * ON THE LENGTH, since the note that used to sit here said the opposite.
 * #892 took out four seams and then declined the fifth, on the grounds that
 * "extracting `wire()` would mean declaring nearly this whole closure as an
 * interface". The real obstacle was narrower, and is written down in
 * `av-state.svelte.ts`: the event surface ASSIGNS seven reactive bindings,
 * and an imported `let` cannot be assigned. #892's own change dissolved that
 * by making all seven fields of a `$state` object, which any scope holding
 * the object may write. #1698 took the seam on that footing, and a host
 * interface turned out to cost the parts rather than the closure — the shape
 * `ClaimHost` and `MicChainHost` were already using.
 */
export function createChannelAv(address: PlaceAddress) {
	// One named place for what the UI watches, one for what the connection
	// keeps to itself (#892) — av-state.svelte.ts says why they are two.
	const av = createAvState();
	const conn = createAvConn();

	/** Record a device the browser refused; a closed share picker says nothing. */
	function failedMedia(cause: unknown, device: MediaDevice) {
		const message = describeMediaError(cause, device);
		if (message) av.error = { message, signIn: false };
	}

	/**
	 * Who is in voice and whether their mic is open (#151). Every part that
	 * learns something about a rider's mic reports it through here, so the
	 * three states a tile tells apart have one writer.
	 */
	function setVoice(id: string, state: 'live' | 'muted' | null) {
		const next = { ...av.voice };
		if (state === null) delete next[id];
		else next[id] = state;
		av.voice = next;
	}

	const stage = createStage();
	// Device selection and the rider-audio bus own their own state (#892).
	// The bus reads the chosen sink through a getter: the AudioContext
	// outlives any one pick.
	const devices = deviceChoices();
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
	const seats = createSeats();
	// A refresh kills the page and the LiveKit room with it. The note this tab
	// leaves behind is what lets the next page walk back in (#480).
	// Keyed by the place (#2449): its address key.
	const note = createNoteKeeper(address.key, () => av.micOn);

	const mic = createMic({ av, conn, devices, talk, setVoice, failedMedia });
	const publish = createPublish({
		av,
		conn,
		seats,
		stage,
		output,
		chain: mic.chain,
		failedMedia,
		setVoice,
		tryOpenMic: mic.tryOpen,
		noteVoice: note.stamp,
	});
	// Built after the two captures because it stands them down: a tab that
	// yields the mic puts the camera down with it (#293).
	const tabs = createTabs({
		av,
		conn,
		mic,
		publish,
		setVoice,
		noteVoice: note.stamp,
	});
	const listeners = createListeners({
		av,
		conn,
		devices,
		chain: mic.chain,
		output,
	});
	const session = createSession({
		avToken: address.avToken,
		av,
		conn,
		devices,
		output,
		talk,
		claims: tabs.claims,
		chain: mic.chain,
		listeners,
		note,
		wire: (r, client) =>
			wireLiveKitRoom(r, client, {
				av,
				conn,
				seats,
				stage,
				output,
				talk,
				claims: tabs.claims,
				chain: mic.chain,
				setVoice,
				claimantOf: tabs.claimantOf,
				takeOver: tabs.takeOver,
				stopNote: note.stop,
			}),
		claimantOf: tabs.claimantOf,
		tryOpenMic: mic.tryOpen,
		setVoice,
	});

	return channelAvApi({
		av,
		conn,
		devices,
		stage,
		output,
		seats,
		mic,
		publish,
		tabs,
		listeners,
		session,
	});
}
