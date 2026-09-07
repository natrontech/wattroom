<script lang="ts">
	import { modals } from '$lib/modals.svelte';
	import { page } from '$app/state';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { chase, pausedChase, playheadAt } from '$lib/room/playhead';
	import { playerInfo } from '$lib/room/jukebox-player.svelte';
	import {
		backIn,
		listening,
		playerAction,
		type Play,
	} from '$lib/room/listening.svelte';
	import { resetServerClock, serverNow } from '$lib/room/server-clock';
	import { withYouTubeApi } from '$lib/room/youtube-api';
	import { toasts } from '$lib/toast.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { onDuck } from '$lib/sound/duck';
	import { formatClockLong } from '$lib/format';
	import { keepSize } from '$lib/pane';
	import { onSeat, stageSlot } from '$lib/room/stage-slot.svelte';
	import Music from '@lucide/svelte/icons/music';
	import VolumeX from '@lucide/svelte/icons/volume-x';

	// THE jukebox player (#216): one iframe, docked on the app frame, alive
	// as long as the room connection is — music follows you between pages the
	// way voice does, every connected client reports 'ended', and ducking
	// works wherever you are. YouTube RMF: ≥200×200, visible while media
	// plays, nothing overlaid — a dock satisfies that on every page.
	//
	// The rider never places it any more (#427). It flies to whichever seat
	// the app offers — the people column, the rail, the stage, TV mode — and
	// every one of those surfaces carries the transport beside it. The corner
	// below is not a window: it is the last resort for a viewport that offers
	// no seat at all (the rail is a closed drawer below md), and RMF still
	// wants the player on screen while it plays.

	const conn = $derived(roomConnection.current);
	const jukebox = $derived(conn?.live.tick?.jukebox);
	let container = $state<HTMLDivElement | null>(null);
	let shell = $state<HTMLDivElement | null>(null);

	// ── Sitting out (#989) ───────────────────────────────────────────────────
	// ponytail: the chase's own 250 ms tick does the unloading. An effect that
	// called tickChase() on the flag would drag every read in the chase into
	// the effect graph (#494), and a quarter second of music is not worth it.
	let outNow = $state(0);
	const play = $derived<Play | null>(
		jukebox?.current
			? { videoId: jukebox.current.videoId, anchorMs: jukebox.anchorMs }
			: null,
	);
	const backInSec = $derived(
		jukebox
			? backIn(listening.durationOf(play), playheadAt(jukebox, outNow))
			: null,
	);

	// ── Placement ─────────────────────────────────────────────────────────────
	// The corner it falls back to, comfortably clear of RMF's 200×200 even
	// with the autoplay-blocked strip taking a bite out of the bottom.
	const PANE = 'jukebox-dock';
	const CORNER = { w: 360, h: 240 };

	// ── Seated (#316, #427) ───────────────────────────────────────────────────
	// The iframe never moves — reparenting it reloads it, and playback, the
	// player object and the room's `ended` reporting die with it. A surface
	// publishes the rect of the hole it left and the dock flies there: the
	// transport belongs to that surface, and a seat with nothing over or
	// beside the player is what keeps RMF satisfied.
	// A modal covers whatever is under it, so the seat under it is no seat:
	// the dock goes to its corner and the modal keeps a gutter above it
	// (modals.svelte).
	// Whether the dock is seated — a boolean, for the chrome. The RECT never
	// passes through here: it arrives frame by frame on `onSeat` and is
	// written straight to the node, so per-frame geometry never enters the
	// effect graph (#494).
	const seat = $derived(modals.open === 0 && stageSlot.seated);
	$effect(() => {
		const node = shell;
		const blocked = modals.open > 0;
		if (!node) return;
		return onSeat((to) => {
			if (to && !blocked) {
				node.style.left = `${to.x}px`;
				node.style.top = `${to.y}px`;
				node.style.right = node.style.bottom = 'auto';
				node.style.width = `${to.w}px`;
				node.style.height = `${to.h}px`;
			} else {
				// Back to the corner its CSS docks it to; the inline rect the
				// seat wrote has to be cleared for those classes to bite.
				node.style.left = node.style.top = '';
				node.style.right = node.style.bottom = '';
				node.style.width = `${CORNER.w}px`;
				node.style.height = `${CORNER.h}px`;
			}
		});
	});

	// ── YouTube IFrame API ────────────────────────────────────────────────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type YtPlayer = any;
	let player: YtPlayer = null;
	let playerReady = $state(false);
	let apiFailed = $state(false);
	let loadedVideo: string | null = null;
	/** The anchor the loaded video belongs to — the same video replayed is a new play. */
	let loadedAnchor = 0;
	/** A livestream has no shared playhead to chase — everyone rides the edge. */
	let streaming = false;

	const UNSTARTED = -1,
		ENDED = 0,
		PLAYING = 1,
		PAUSED = 2,
		BUFFERING = 3,
		CUED = 5;

	// A rider's browser can carry its own "always show captions" YouTube
	// preference, applied across every embed regardless of the video — and
	// with the player's own chrome hidden (RMF: nothing overlaid), there is
	// no CC button in here to turn it back off. Force the module off instead
	// of exposing one. It resets per video, so this re-fires on every load.
	function disableCaptions() {
		player?.unloadModule?.('captions');
	}

	/** Report the end against the anchor we were playing — never the newest one. */
	function reportEnded() {
		if (loadedVideo)
			conn?.live.jukebox({
				action: 'ended',
				videoId: loadedVideo,
				anchorMs: loadedAnchor,
			});
	}

	$effect(() => {
		const node = container;
		if (!node || player) return;
		// A blocked iframe_api (adblock, corporate DNS) must say so instead of
		// rendering a silent black tile forever (#219).
		const failTimer = setTimeout(() => {
			if (!playerReady) apiFailed = true;
		}, 8_000);
		withYouTubeApi(() => {
			clearTimeout(failTimer);
			if (player) return; // two queued callbacks must not build twice
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			player = new (window as any).YT.Player(node, {
				width: '100%',
				height: '100%',
				// Privacy-enhanced mode (#232): the player iframe comes from the
				// nocookie host, still through the official IFrame API.
				host: 'https://www.youtube-nocookie.com',
				playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1 },
				events: {
					onReady: () => {
						// The ducking effect sets the volume on its first run,
						// which this readiness triggers — a second setter here
						// would hand a rider who is away one blast of music at
						// full level (#875).
						playerReady = true;
						disableCaptions();
					},
					onStateChange: (e: { data: number }) => {
						// A state the browser granted means autoplay was not refused.
						if (e.data === PLAYING || e.data === BUFFERING)
							playerInfo.blocked = false;
						// Ended: report it WITH the play epoch — the server
						// advances exactly once per (video, epoch).
						if (e.data === ENDED) reportEnded();
						// The caption module attaches once the video's own data
						// lands, asynchronously after cue/load — CUED and PLAYING
						// bracket that, so unloading here catches it even when the
						// call right after cue/loadVideoById was too early.
						if (e.data === CUED || e.data === PLAYING) disableCaptions();
					},
					onError: (e: { data: number }) => {
						// Non-embeddable or broken: skip for everyone rather than
						// leaving each rider staring at a different error — but SAY
						// so. Labels and most livestreams refuse embedding, and the
						// track just vanishing read as the paste being ignored.
						toasts.push(
							e.data === 101 || e.data === 150
								? 'That video blocks playback outside YouTube — skipped. Try another upload of it.'
								: 'That video could not be played here — skipped.',
						);
						reportEnded();
					},
				},
			});
		});
		return () => {
			clearTimeout(failTimer);
			// The dock unmounts only when the connection ends — tear the
			// iframe down cleanly so a rejoin starts fresh.
			player?.destroy?.();
			player = null;
			playerReady = false;
			loadedVideo = null;
			streaming = false;
			playerInfo.duration = 0;
			playerInfo.live = false;
			playerInfo.drift = 0;
			playerInfo.blocked = false;
		};
	});

	// ── Ducking (#24, ramps per #152): dip under voice, wherever you are. ────
	let baseVolume = mixer.music;
	let rampTimer: ReturnType<typeof setInterval> | undefined;

	function rampTo(target: number, ms: number) {
		clearInterval(rampTimer);
		if (ms <= 0) {
			player.setVolume?.(Math.round(target));
			return;
		}
		const from = player.getVolume?.() ?? target;
		const steps = Math.max(1, Math.round(ms / 30));
		let step = 0;
		rampTimer = setInterval(() => {
			step += 1;
			const v = from + ((target - from) * step) / steps;
			player.setVolume?.(Math.round(v));
			if (step >= steps) clearInterval(rampTimer);
		}, 30);
	}

	// The attack, the hold and the release belong to the duck controller
	// (#988), not to this effect. They used to live on timers created inside
	// it, and a Svelte effect's cleanup runs before every RE-RUN, not only on
	// destroy — so any dependency changing inside the 600 ms hold cleared the
	// timer that was going to bring the music back, and it sat at 25 % until
	// the next duck cycle happened to end cleanly. That is the "not on time"
	// riders heard as the music simply never returning.
	//
	// What is left here re-runs freely: it reads the ceiling the mixer owns
	// (#179, and away takes it to nothing — #875) and subscribes. Subscribing
	// hands back the current state with `ms: 0`, so a fader move still acts
	// NOW rather than through a hold, which is what made the slider feel dead
	// (audit #219).
	$effect(() => {
		if (!playerReady) return;
		baseVolume = mixer.muted ? 0 : mixer.music;
		const depth = mixer.duck;
		const ceiling = baseVolume;
		return onDuck(({ down, ms }) =>
			rampTo(Math.round(down ? ceiling * depth : ceiling), ms),
		);
	});

	// The ramp itself is this component's, so it stops when the component
	// does — and only then. No reactive read, so this never re-runs.
	$effect(() => () => clearInterval(rampTimer));

	// ── Chase the room's playhead (#286, docs/SPEC.md sync tolerances) ───────
	//
	// On SERVER time, seek-first, on its own 250 ms timer rather than on the
	// 1 Hz tick: a stalled tick used to freeze the correction, and the
	// rider's own wall clock used to define the target it chased.
	const SETTLE_MS = 1_200;
	let settleUntil = 0;
	let wantedPlayAt = 0;

	function unload() {
		player.stopVideo?.();
		loadedVideo = null;
		streaming = false;
		playerInfo.duration = 0;
		playerInfo.live = false;
		playerInfo.drift = 0;
		playerInfo.blocked = false;
	}

	function load(videoId: string, at: number, playing: boolean) {
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
			player.loadVideoById(videoId, at);
			wantedPlayAt = performance.now();
		} else {
			player.cueVideoById(videoId, at);
			wantedPlayAt = 0;
		}
		disableCaptions();
	}

	// Fullscreen draws only the fullscreen element's subtree: a fixed dock
	// outside it is not rendered at all while the music plays on — the exact
	// RMF condition the dock exists to satisfy (#395). Pause this client's
	// player for the duration; on exit the chase re-seeks and resumes.
	let hiddenByFullscreen = $state(false);
	$effect(() => {
		const check = () => {
			const full = document.fullscreenElement;
			hiddenByFullscreen = !!full && !!shell && !full.contains(shell);
			if (!hiddenByFullscreen) tickChase();
		};
		document.addEventListener('fullscreenchange', check);
		return () => document.removeEventListener('fullscreenchange', check);
	});

	function tickChase() {
		if (!player || !playerReady) return;
		if (hiddenByFullscreen) {
			if (player.getPlayerState?.() === PLAYING) player.pauseVideo?.();
			return;
		}
		const live = conn?.live;
		const deck = live?.tick?.jukebox;
		if (live?.status !== 'live' || !deck) {
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
		// on — the same shape as `hiddenByFullscreen` above, except the player
		// UNLOADS rather than pausing: a rider who is not listening should not
		// be streaming. Away (#875) routes through the same door, so coming
		// back rejoins by itself.
		listening.sees(nowPlay);
		const action = playerAction(listening.out || mixer.muted, !!loadedVideo);
		if (action !== 'chase') {
			if (action === 'unload') unload();
			// Only clients know how long a track is, so the length dies with
			// the player: keep it for the play we measured and admit to
			// knowing nothing about the next one.
			playerInfo.duration = listening.durationOf(nowPlay);
			return;
		}

		if (!deck.current) {
			if (loadedVideo) unload();
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
			load(deck.current.videoId, target, deck.playing);
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
			reportEnded();
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
					player.seekTo(next.to, true);
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
			performance.now() - wantedPlayAt > 2_000
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
			player.seekTo(next.to, true);
			settleUntil = performance.now() + SETTLE_MS;
		} else if (player.getPlaybackRate?.() !== next.rate) {
			// Sub-second drift closes on the rate instead of a stutter. An
			// embed that rounds the request away just drifts on until the
			// seek tier catches it — no worse than not asking.
			player.setPlaybackRate?.(next.rate);
		}
	}

	$effect(() => {
		if (!playerReady) return;
		const timer = setInterval(() => {
			tickChase();
			// The bar stays truthful while nothing streams: the tick is still
			// read, it is only the player that is gone.
			if (listening.out) outNow = serverNow();
		}, 250);
		// A hidden tab throttles timers while the media element keeps playing,
		// and every tick it received arrived late — so a tab coming back is
		// holding a stale playhead AND a clock estimate biased by whatever
		// its delivery was batched by. Drop the sample window so it re-learns
		// from prompt ticks, then re-measure — on the estimate it learned on
		// screen, which the reset keeps (#644), never the rider's wall clock.
		const onVisible = () => {
			if (document.visibilityState !== 'visible') return;
			resetServerClock();
			tickChase();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	function startPlayback() {
		playerInfo.blocked = false;
		wantedPlayAt = performance.now();
		player?.playVideo?.();
	}

	// Away is the rider being elsewhere: nothing to look at, and nothing
	// plays, so RMF's "visible while media plays" is not engaged either.
	const showPlayer = $derived(!!jukebox?.current && !mixer.muted);
</script>

{#if conn}
	<!-- With no seat on offer the dock sits in the corner, above the chat
	     button below xl (#219). Stacking (#483): floating, it sits BELOW
	     dialogs, drawers and toasts (z-40/z-50) — RMF forbids OUR chrome over
	     the player, not a dialog the rider opened over it. Seated, it has to
	     clear the surface it sits in — a popped-out stage is z-[55] — but not
	     the chat sheet, which is a drawer the rider opened and passes above at
	     z-[60]. -->
	<div
		bind:this={shell}
		data-pane={PANE}
		data-seated={seat ? '' : undefined}
		{@attach (node) => keepSize(node, PANE)}
		class="bg-surface fixed {seat
			? 'z-[56]'
			: 'z-30'} flex flex-col overflow-hidden rounded-lg {seat
			? ''
			: 'ring-ink/15 shadow-2xl ring-1'} {showPlayer
			? ''
			: 'hidden'} {page.url.pathname.startsWith('/r/')
			? 'right-4 bottom-20 xl:right-[calc(var(--pane-side-panel-w,320px)+1.25rem)] xl:bottom-4'
			: 'right-4 bottom-4'}"
		style="width: {CORNER.w}px; height: {CORNER.h}px; max-width: 96vw;
			max-height: 90vh"
	>
		<div class="flex min-h-0 flex-1 bg-black {listening.out ? 'hidden' : ''}">
			<!-- ≥200×200, always visible while media plays, nothing overlaid. -->
			<div class="relative min-w-0 flex-1">
				<div bind:this={container} class="h-full w-full"></div>
				{#if apiFailed}
					<div
						class="text-muted absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-xs"
					>
						The player could not load — a blocker may be stopping YouTube. The
						room's music continues for everyone else.
					</div>
				{/if}
			</div>
		</div>

		{#if listening.out}
			<!-- Out (#989): the player is unloaded, so there is no stream and no
		     video element — RMF's "visible while media plays" is not engaged
		     because nothing plays for this rider. What is left names what the
		     room is on, read from the tick, and the way back in. Chrome, so
		     no glow: magenta is live data (ADR-0005). -->
			<div
				class="text-muted flex min-h-0 flex-1 flex-col justify-center gap-2 p-3 text-xs"
			>
				<p class="flex min-w-0 items-center gap-1.5">
					<Music size={13} class="shrink-0" />
					<span class="min-w-0 truncate">{jukebox?.current?.title}</span>
				</p>
				<div class="flex min-w-0 items-center justify-between gap-2">
					<span class="min-w-0 truncate"
						>{listening.mode === 'skip' && backInSec !== null
							? `back in ${formatClockLong(backInSec)}`
							: listening.mode === 'skip'
								? 'back on the next track'
								: 'the room is listening'}</span
					>
					<button
						onclick={() => listening.rejoin()}
						class="btn btn-secondary btn-xs shrink-0"
						>{listening.mode === 'skip' ? 'Rejoin now' : 'Rejoin'}</button
					>
				</div>
			</div>
		{/if}

		{#if showPlayer && !listening.out && playerInfo.blocked}
			<!-- The browser refused to start audio with no gesture behind it.
			     One press fixes it for the session. Beside the player, never
			     over it (RMF) — and quiet: this is chrome, and magenta means
			     live data (ADR-0005). A full-width accent bar read as an
			     error (#485). -->
			<div
				class="border-ink/10 text-muted flex shrink-0 items-center gap-2 border-t px-2 py-1.5 text-[11px]"
			>
				<VolumeX size={13} class="shrink-0" />
				<span class="min-w-0 flex-1 truncate">Your browser muted this tab.</span
				>
				<button
					onclick={startPlayback}
					class="btn btn-secondary btn-xs shrink-0">Play</button
				>
			</div>
		{/if}
	</div>
{/if}
