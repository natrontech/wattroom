<script lang="ts">
	import { modals } from '$lib/modals.svelte';
	import { page } from '$app/state';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { playheadAt } from '$lib/room/playhead';
	import { playerInfo } from '$lib/room/jukebox-player.svelte';
	import { backIn, listening, type Play } from '$lib/room/listening.svelte';
	import { createJukeboxChase } from '$lib/room/jukebox-chase';
	import { createMusicRamp } from '$lib/room/music-ramp';
	import { resetServerClock, serverNow } from '$lib/room/server-clock';
	import {
		BUFFERING,
		CUED,
		ENDED,
		PLAYING,
		withYouTubeApi,
		type YTPlayer,
	} from '$lib/room/youtube-api';
	import { toasts } from '$lib/toast.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { onDuck } from '$lib/sound/duck';
	import { formatClockLong } from '$lib/format';
	import { keepSize } from '$lib/pane';
	import { onSeat, stageSlot } from '$lib/room/stage-slot.svelte';
	import Music from '@lucide/svelte/icons/music';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import { youtubeFailureIsGlobal } from '$lib/room/playback-failure';

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
	//
	// What this component owns is the iframe and its chrome. Staying on the
	// room's playhead is `jukebox-chase.ts` and arriving at a volume is
	// `music-ramp.ts` — both outside the effect graph on purpose (#494).

	const conn = $derived(roomConnection.current);
	const jukebox = $derived(conn?.live.tick?.jukebox);
	let container = $state<HTMLDivElement | null>(null);
	let shell = $state<HTMLDivElement | null>(null);

	// ── Sitting out (#989) ───────────────────────────────────────────────────
	// ponytail: the chase's own 250 ms tick does the unloading. An effect that
	// called chase.tick() on the flag would drag every read in the chase into
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
	let player: YTPlayer | null = null;
	let playerReady = $state(false);
	let apiFailed = $state(false);

	// Fullscreen draws only the fullscreen element's subtree: a fixed dock
	// outside it is not rendered at all while the music plays on — the exact
	// RMF condition the dock exists to satisfy (#395). The chase pauses this
	// client's player for the duration; on exit it re-seeks and resumes.
	let hiddenByFullscreen = $state(false);

	// A rider's browser can carry its own "always show captions" YouTube
	// preference, applied across every embed regardless of the video — and
	// with the player's own chrome hidden (RMF: nothing overlaid), there is
	// no CC button in here to turn it back off. Force the module off instead
	// of exposing one. It resets per video, so this re-fires on every load.
	function disableCaptions() {
		player?.unloadModule?.('captions');
	}

	function sendEnded(on: Play) {
		conn?.live.jukebox({
			action: 'ended',
			videoId: on.videoId,
			anchorMs: on.anchorMs,
		});
	}

	/** Report the end against the anchor we were playing — never the newest one. */
	function reportEnded() {
		const on = chase.playing;
		if (on) sendEnded(on);
	}

	const chase = createJukeboxChase({
		// Not ready is not a player: everything the chase does would be a call
		// into an iframe that has not finished building itself.
		player: () => (playerReady ? player : null),
		deck: () => {
			const live = conn?.live;
			return live?.status === 'live' ? (live.tick?.jukebox ?? null) : null;
		},
		hidden: () => hiddenByFullscreen,
		ended: sendEnded,
		loaded: disableCaptions,
	});

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
						// Non-embeddable or gone: skip for everyone rather than
						// leaving each rider staring at a different error — but SAY
						// so. Labels and most livestreams refuse embedding, and the
						// track just vanishing read as the paste being ignored.
						if (youtubeFailureIsGlobal(e.data)) {
							toasts.push(
								e.data === 101 || e.data === 150
									? 'That video blocks playback outside YouTube — skipped. Try another upload of it.'
									: 'That video could not be played here — skipped.',
							);
							reportEnded();
							return;
						}
						// This browser's own trouble (#1896): the room plays on and
						// this rider sits the track out, back in on the next one.
						toasts.push(
							'That video could not be played here — the room plays on; you are back in on the next track.',
						);
						listening.stepOut('skip', play, playerInfo.duration);
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
			chase.reset();
		};
	});

	// ── Ducking (#24, ramps per #152): dip under voice, wherever you are. ────
	//
	// The attack, the hold and the release belong to the duck controller
	// (#988), and the steps that get there to the ramp — neither is an
	// effect. They used to live on timers created inside one, and a Svelte
	// effect's cleanup runs before every RE-RUN, not only on destroy — so any
	// dependency changing inside the 600 ms hold cleared the timer that was
	// going to bring the music back, and it sat at 25 % until the next duck
	// cycle happened to end cleanly. That is the "not on time" riders heard
	// as the music simply never returning.
	//
	// What is left here re-runs freely: it reads the ceiling the mixer owns
	// (#179, and away takes it to nothing — #875) and subscribes. Subscribing
	// hands back the current state with `ms: 0`, so a fader move still acts
	// NOW rather than through a hold, which is what made the slider feel dead
	// (audit #219).
	const ramp = createMusicRamp({
		read: () => player?.getVolume?.(),
		write: (volume) => player?.setVolume?.(volume),
	});
	$effect(() => {
		if (!playerReady) return;
		const ceiling = mixer.muted ? 0 : mixer.music;
		const depth = mixer.duck;
		return onDuck(({ down, ms }) =>
			ramp.to(Math.round(down ? ceiling * depth : ceiling), ms),
		);
	});

	// The ramp itself is this component's, so it stops when the component
	// does — and only then. No reactive read, so this never re-runs.
	$effect(() => () => ramp.stop());

	// ── Chase the room's playhead (#286) ─────────────────────────────────────
	// On its own 250 ms timer rather than on the 1 Hz tick: a stalled tick
	// used to freeze the correction. What each tick decides is jukebox-chase.
	$effect(() => {
		const check = () => {
			const full = document.fullscreenElement;
			hiddenByFullscreen = !!full && !!shell && !full.contains(shell);
			if (!hiddenByFullscreen) chase.tick();
		};
		document.addEventListener('fullscreenchange', check);
		return () => document.removeEventListener('fullscreenchange', check);
	});

	$effect(() => {
		if (!playerReady) return;
		const timer = setInterval(() => {
			chase.tick();
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
			chase.tick();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	function startPlayback() {
		playerInfo.blocked = false;
		chase.wantPlay();
		player?.playVideo?.();
	}

	// Away is the rider being elsewhere: nothing to look at, and nothing
	// plays, so RMF's "visible while media plays" is not engaged either.
	// A pool track has no picture and no player to show (#267) — the dock
	// stays out of the way rather than framing an empty iframe.
	const showPlayer = $derived(
		!!jukebox?.current && !jukebox.current.trackId && !mixer.muted,
	);
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
