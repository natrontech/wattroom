import type { JukeboxState } from '$lib/protocol';
import { playerInfo } from '$lib/room/jukebox-player.svelte';
import { listening, playerAction, type Play } from '$lib/room/listening.svelte';
import { chase, pausedChase, playheadAt } from '$lib/room/playhead';
import { serverNow } from '$lib/room/server-clock';
import {
	BUFFERING,
	PAUSED,
	PLAYING,
	UNSTARTED,
	type YTPlayer,
} from '$lib/room/youtube-api';
import { mixer } from '$lib/sound/mixer.svelte';

/**
 * Keeping ONE client's embed on the room's playhead (#286, docs/SPEC.md sync
 * tolerances). `playhead.ts` decides what a drift is worth — a seek, a rate
 * nudge, or nothing; this drives the player through those decisions and owns
 * the state they need: what is loaded, against which anchor, whether it is a
 * livestream, and how long a correction is left to settle.
 *
 * It runs on its own 250 ms timer rather than on the 1 Hz tick, on SERVER
 * time: a stalled tick used to freeze the correction, and the rider's own
 * wall clock used to define the target it chased.
 *
 * Not an effect, and deliberately outside the effect graph (#494): every read
 * in here — the tick, the mixer, who is listening — would otherwise become a
 * dependency of the component that hosts the player, and re-run a quarter of
 * a second's worth of player calls whenever any of them moved.
 */

/** A seek reads back stale while it buffers; measuring through one turned a correction into a storm. */
const SETTLE_MS = 1_200;

/** Autoplay refused: no gesture behind the tab, so nothing starts and the rider has nothing to press. */
const REFUSED_MS = 2_000;

/** What the room's chase needs from the client that hosts the player. */
export interface ChaseHost {
	/** The embed, once it is built and ready; null before that and after teardown. */
	player(): YTPlayer | null;
	/**
	 * The deck this tick, or null when there is nothing to chase — a
	 * reconnect, or a room with no jukebox state yet.
	 */
	deck(): JukeboxState | null;
	/**
	 * Whether this client is not drawing the player at all (something else is
	 * fullscreen, #395). It pauses rather than chases: RMF wants the player
	 * visible while media plays, and a fixed dock outside the fullscreen
	 * element is not rendered.
	 */
	hidden(): boolean;
	/** The loaded play is over, as far as this client can tell — report it to the room. */
	ended(play: Play): void;
	/** A video was just cued or loaded: per-video player settings need re-applying. */
	loaded(): void;
}

export interface JukeboxChase {
	/** One correction. On the timer, and again whenever something makes the answer stale. */
	tick(): void;
	/** The play this client has loaded, for whoever reports against it — never the newest one. */
	readonly playing: Play | null;
	/** A play was just asked for by hand; start the autoplay-refusal watchdog. */
	wantPlay(): void;
	/** The iframe is going away: forget what was loaded and stop claiming to know a duration. */
	reset(): void;
}

export function createJukeboxChase(host: ChaseHost): JukeboxChase {
	let loadedVideo: string | null = null;
	/** The anchor the loaded video belongs to — the same video replayed is a new play. */
	let loadedAnchor = 0;
	/** A livestream has no shared playhead to chase — everyone rides the edge. */
	let streaming = false;
	let settleUntil = 0;
	let wantedPlayAt = 0;

	function forget(): void {
		loadedVideo = null;
		streaming = false;
		playerInfo.duration = 0;
		playerInfo.live = false;
		playerInfo.drift = 0;
		playerInfo.blocked = false;
	}

	function unload(player: YTPlayer): void {
		player.stopVideo?.();
		forget();
	}

	function load(
		player: YTPlayer,
		videoId: string,
		at: number,
		playing: boolean,
	): void {
		loadedVideo = videoId;
		streaming = false;
		playerInfo.live = false;
		playerInfo.drift = 0;
		settleUntil = performance.now() + SETTLE_MS;
		// A rate left at 1.25 by an older client (or the rider's own menu)
		// outlives the video it was set on.
		player.setPlaybackRate?.(1);
		// cue, not load, while the room is paused: loadVideoById autoplays, so
		// joining a paused room used to blast a second of audio at everyone.
		if (playing) {
			player.loadVideoById?.(videoId, at);
			wantedPlayAt = performance.now();
		} else {
			player.cueVideoById?.(videoId, at);
			wantedPlayAt = 0;
		}
		host.loaded();
	}

	function tick(): void {
		const player = host.player();
		if (!player) return;
		if (host.hidden()) {
			if (player.getPlayerState?.() === PLAYING) player.pauseVideo?.();
			return;
		}
		const deck = host.deck();
		if (!deck) {
			// No ticks, nothing to chase: a nudge left running through a
			// reconnect walks the player away from the room it will rejoin.
			player.setPlaybackRate?.(1);
			return;
		}

		const nowPlay: Play | null = deck.current
			? { videoId: deck.current.videoId, anchorMs: deck.anchorMs }
			: null;
		// ── Sitting out (#989) ───────────────────────────────────────────────
		// A second local reason to take this client out while the room plays
		// on — the same shape as `hidden()` above, except the player UNLOADS
		// rather than pausing: a rider who is not listening should not be
		// streaming. Away (#875) routes through the same door, so coming back
		// rejoins by itself.
		listening.sees(nowPlay);
		const action = playerAction(listening.out || mixer.muted, !!loadedVideo);
		if (action !== 'chase') {
			if (action === 'unload') unload(player);
			// Only clients know how long a track is, so the length dies with
			// the player: keep it for the play we measured and admit to
			// knowing nothing about the next one.
			playerInfo.duration = listening.durationOf(nowPlay);
			return;
		}

		// A pool track belongs to AudioDeck (#267): it carries no video id, and
		// loading "" makes the iframe raise an unplayable-video error, which
		// the dock then answers by SKIPPING the entry. The room's own track
		// would be skipped by the player that cannot play it.
		if (!deck.current || deck.current.trackId) {
			if (loadedVideo) unload(player);
			return;
		}

		const target = playheadAt(deck, serverNow());
		// A repeat of the same video arrives with a new anchor — a new play,
		// not the one already loaded.
		if (
			loadedVideo !== deck.current.videoId ||
			loadedAnchor !== deck.anchorMs
		) {
			loadedAnchor = deck.anchorMs;
			load(player, deck.current.videoId, target, deck.playing);
			return;
		}

		// A livestream has no fixed timeline: the room's anchor walks off into
		// the DVR window and the drift chase seeks on every tick, which is what
		// made pasted live links unplayable. Ride the edge instead.
		if (!streaming && player.getVideoData?.()?.isLive) {
			streaming = true;
			playerInfo.live = true;
			player.seekTo?.(player.getDuration?.() ?? 0, true);
		}
		playerInfo.duration = streaming ? 0 : player.getDuration?.() || 0;

		// Only clients know how long a track is — the server holds an anchor,
		// not a timeline. A deck left playing to an empty room runs its
		// playhead off the end, and the next rider to arrive inherits a
		// position no player can reach: it lands past the end, restarts, gets
		// seeked past the end again, forever. Whoever notices says the track
		// is over, exactly as if it had ended in front of them.
		if (
			deck.playing &&
			playerInfo.duration > 0 &&
			target >= playerInfo.duration
		) {
			host.ended({ videoId: loadedVideo, anchorMs: loadedAnchor });
			return;
		}

		const state = player.getPlayerState?.() ?? UNSTARTED;
		if (!deck.playing) {
			if (state === PLAYING || state === BUFFERING) player.pauseVideo?.();
			playerInfo.drift = 0;
			playerInfo.blocked = false;
			// A scrub while paused moves the server's anchor but not this
			// player: nothing else re-seeks a stopped deck, so the chase has
			// to (#647) — otherwise the rider sees the bar and clock jump
			// while the picture holds the old frame.
			if (
				!streaming &&
				performance.now() >= settleUntil &&
				state !== BUFFERING
			) {
				const at = player.getCurrentTime?.() ?? 0;
				const next = pausedChase(target, at);
				if (next?.do === 'seek') {
					player.seekTo?.(next.to, true);
					settleUntil = performance.now() + SETTLE_MS;
				}
			}
			return;
		}
		if (state === PAUSED || state === UNSTARTED) {
			player.playVideo?.();
			if (!wantedPlayAt) wantedPlayAt = performance.now();
		}
		// Autoplay policy: a browser with no gesture behind it refuses to
		// start, and the rider then hears nothing with nothing to press.
		if (
			wantedPlayAt &&
			state !== PLAYING &&
			state !== BUFFERING &&
			performance.now() - wantedPlayAt > REFUSED_MS
		)
			playerInfo.blocked = true;

		// A seek lands asynchronously and reads back stale while it buffers —
		// measuring through it is what turned one correction into a storm. The
		// rate is left alone through the settle: a nudge is harmless, and
		// resetting it here would undo the correction mid-flight.
		if (streaming || performance.now() < settleUntil || state === BUFFERING)
			return;

		const at = player.getCurrentTime?.() ?? 0;
		playerInfo.drift = at - target;
		const next = chase(target, at, false);
		if (next.do === 'seek') {
			// allowSeekAhead: the target is usually outside the buffer.
			player.setPlaybackRate?.(1);
			player.seekTo?.(next.to, true);
			settleUntil = performance.now() + SETTLE_MS;
		} else if (player.getPlaybackRate?.() !== next.rate) {
			// Sub-second drift closes on the rate instead of a stutter. An
			// embed that rounds the request away just drifts on until the
			// seek tier catches it — no worse than not asking.
			player.setPlaybackRate?.(next.rate);
		}
	}

	return {
		tick,
		get playing(): Play | null {
			return loadedVideo
				? { videoId: loadedVideo, anchorMs: loadedAnchor }
				: null;
		},
		wantPlay(): void {
			wantedPlayAt = performance.now();
		},
		reset: forget,
	};
}
