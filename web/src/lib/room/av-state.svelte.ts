import type { Room as LiveKitRoom } from 'livekit-client';
import type { AvError, AvStatus, LiveKitClient } from '$lib/room/av-types';

/**
 * One room's AV connection, in two named places (#892).
 *
 * This split is what let every other seam leave. The bindings below used to
 * be `let`s in one closure, and `$state` reactivity rides on assignment in
 * the scope that declared it — an imported `let` cannot be assigned at all.
 * So every piece that wrote any of this was pinned to the same file as the
 * declaration, which is why that closure kept growing.
 *
 * Fields of a `$state` object have neither limit: they can be written from
 * anywhere holding the object, and stay reactive. #892 named the scope and
 * stopped there, judging the event surface unliftable; on this footing it
 * lifted like the rest (#1698, `av-wire.ts`), and seven of the fields below
 * — `speaking`, `voice`, `camOn`, `micOn`, `sharing`, `handedOff`, `status` —
 * are written from there.
 *
 * Two containers, and the split is not cosmetic. `AvState` is what the UI
 * reads, so it is `$state`. `AvConn` is the connection's own bookkeeping and
 * is deliberately NOT: `$state` proxies deeply, and handing the SDK a proxy
 * of its own `Room` instead of the `Room` is not a thing to discover in
 * production.
 */
export interface AvState {
	status: AvStatus;
	micOn: boolean;
	camOn: boolean;
	/**
	 * Stepped out (#706). What was live when the rider pressed the button
	 * lives on `AvConn`, so coming back restores that rather than a default.
	 */
	away: boolean;
	sharing: boolean;
	/**
	 * Whether the share is carrying this machine's SOUND as well as its
	 * picture (#1124). Its own flag rather than an assumption from `sharing`:
	 * loopback capture can be refused, unavailable, or silently dead, and a
	 * rider must not be told the room can hear them when it cannot — nor left
	 * unaware when it can.
	 */
	sharingAudio: boolean;
	/**
	 * Whether the rider WANTS the room to hear their machine (#1751), as
	 * opposed to `sharingAudio`, which is whether it does. Two facts, because
	 * a platform can refuse: Linux Chromium has no loopback at all.
	 *
	 * Remembered per device. The report was that every share started loud, and
	 * a rider who says no is saying it about sharing, not about this share.
	 */
	shareSound: boolean;
	error: AvError | null;
	/** Who is talking, measured rather than remembered (#987). */
	speaking: Record<string, boolean>;
	/**
	 * Bumped when LiveKit drops us while live — the connection auto-rejoins
	 * once with a fresh token (#219: token expiry, transient drops).
	 */
	dropped: number;
	/**
	 * Who is in voice and whether their mic is open (#151): absent = not in
	 * voice at all — three states a tile can tell apart at a glance.
	 */
	voice: Record<string, 'live' | 'muted'>;
	/**
	 * This tab gave the mic and camera to another tab of yours (#293). Not an
	 * error and not transient — a persistent status with one button back,
	 * because a rider three metres away must be able to see why they went
	 * quiet without reading a toast that has already gone.
	 */
	handedOff: boolean;
	/**
	 * The browser refused to start audio without a gesture behind it (#645).
	 * Persistent status, not a toast: the rider is on a bike three metres from
	 * the screen, and the room has gone silent — it has to still be there when
	 * they look up (errors.md).
	 */
	playbackBlocked: boolean;
}

const SHARE_SOUND_KEY = 'wattroom.share-sound.v1';

/**
 * The rider's standing answer on the machine's sound (#1751).
 *
 * On unless they said otherwise: every picker that ASKS — Chrome's "share tab
 * audio", the shell's own checkbox on Windows (#1699) — already has their
 * answer, and defaulting to off would mute the rider who ticked the box. The
 * one that never asks is macOS's system picker, which is where the report
 * came from, and there this is the only place the question can be put.
 */
function shareSoundWanted(): boolean {
	try {
		return localStorage.getItem(SHARE_SOUND_KEY) !== 'off';
	} catch {
		return true;
	}
}

export function rememberShareSound(on: boolean): void {
	try {
		localStorage.setItem(SHARE_SOUND_KEY, on ? 'on' : 'off');
	} catch {
		// per-device preference; losing it costs one press
	}
}

/** What the UI watches. */
export function createAvState(): AvState {
	// `$state` has to initialise a declaration, so it cannot be returned inline.
	const state: AvState = $state({
		status: 'off',
		micOn: false,
		camOn: false,
		away: false,
		sharing: false,
		sharingAudio: false,
		shareSound: shareSoundWanted(),
		error: null,
		speaking: {},
		dropped: 0,
		voice: {},
		handedOff: false,
		playbackBlocked: false,
	});
	return state;
}

/** What the connection keeps for itself. Never reactive — see above. */
export interface AvConn {
	/** Loaded only when a rider actually starts AV, after the token lands. */
	liveKit: LiveKitClient | null;
	room: LiveKitRoom | null;
	/** This connection's identity and the rider behind it (#293). */
	myIdentity: string;
	me: string;
	/** What was live when the rider stepped out, so coming back restores it. */
	micBeforeAway: boolean;
	camBeforeAway: boolean;
	/**
	 * Whether the mic was open when LiveKit dropped us, for the rejoin (#641).
	 * The Disconnected handler clears `micOn` before the rejoin fires, and a
	 * rider who muted for a phone call must not come back publishing.
	 */
	micBeforeDrop: boolean;
}

export function createAvConn(): AvConn {
	return {
		liveKit: null,
		room: null,
		myIdentity: '',
		me: '',
		micBeforeAway: false,
		camBeforeAway: false,
		micBeforeDrop: false,
	};
}
