<script lang="ts">
	import { modals } from '$lib/modals.svelte';
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { chase, clampSeek, playheadAt } from '$lib/room/playhead';
	import { IN_SYNC_SEC, playerInfo } from '$lib/room/jukebox-player.svelte';
	import { resetServerClock, serverNow } from '$lib/room/server-clock';
	import { toasts } from '$lib/toast.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import {
		centrePane,
		dragPane,
		keepSize,
		resizePane,
		restorePane,
	} from '$lib/pane';
	import { onSeat, setPopped, stageSlot } from '$lib/room/stage-slot.svelte';
	import {
		VolumeX,
		FastForward,
		GripHorizontal,
		Minimize2,
		Pause,
		PictureInPicture2,
		Play,
		Rewind,
		SkipForward,
		Volume2,
	} from '@lucide/svelte';

	// THE jukebox player (#216): one iframe, docked on the app frame, alive
	// as long as the room connection is — music follows you between pages the
	// way voice does, every connected client reports 'ended', and ducking
	// works wherever you are. YouTube RMF: ≥200×200, visible while media
	// plays, nothing overlaid — a dock satisfies that on every page.
	//
	// The dock is placed by the rider (rider report: "stuck bottom right, can
	// never be centred"): drag the handle, drag any edge or corner to resize,
	// and both survive navigation and reload.

	const conn = $derived(roomConnection.current);
	const jukebox = $derived(conn?.live.tick?.jukebox);
	const ducked = $derived.by(() => {
		const speaking = conn?.av.speaking ?? {};
		return Object.entries(speaking).some(
			([id, active]) => active && id !== account.me?.id,
		);
	});

	let container = $state<HTMLDivElement | null>(null);
	let shell = $state<HTMLDivElement | null>(null);

	// ── Placement ─────────────────────────────────────────────────────────────
	// Drag, resize and remember are the shared pane helpers ($lib/pane) — the
	// stage's popped-out window works the same way. Min size is the RMF floor
	// plus the two chrome strips, enforced in CSS, so the player itself can
	// never be dragged below 200×200.
	const PANE = 'jukebox-dock';
	const CHROME = 56;
	const FLOATING = { w: 380, h: 252 + CHROME };

	// ── Seated in the room's stage (#316) ─────────────────────────────────────
	// The iframe never moves — reparenting it reloads it, and playback, the
	// player object and the room's `ended` reporting die with it. The stage
	// publishes the rect of the hole it left and the dock flies there, chrome
	// off: the room page has the transport in its side panel, and a seat with
	// nothing over or beside the player is what keeps RMF satisfied. Lose the
	// seat (leave the room, scroll it away) and it floats again.
	// A modal covers the stage, so the seat under it is no seat: the dock
	// goes to its corner and the modal keeps a gutter above it (modals.svelte).
	// Whether the dock is seated — a boolean, for the chrome. The RECT never
	// passes through here: it arrives frame by frame on `onSeat` and is
	// written straight to the node, so per-frame geometry never enters the
	// effect graph (#494).
	const seat = $derived(modals.open === 0 && stageSlot.seated);
	$effect(() => {
		const node = shell;
		// A modal covers the stage, so the seat under it is no seat: the dock
		// goes to its corner and the modal keeps clear of it (modals.svelte).
		const blocked = modals.open > 0;
		if (!node) return;
		return onSeat((to) => {
			if (to && !blocked) {
				node.style.left = `${to.x}px`;
				node.style.top = `${to.y}px`;
				node.style.right = node.style.bottom = 'auto';
				node.style.width = `${to.w}px`;
				node.style.height = `${to.h}px`;
				node.style.minWidth = node.style.minHeight = '0';
			} else {
				node.style.minWidth = '260px';
				node.style.minHeight = `${200 + CHROME}px`;
				restorePane(node, PANE, FLOATING);
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
		BUFFERING = 3;

	/** Report the end against the anchor we were playing — never the newest one. */
	function reportEnded() {
		if (loadedVideo)
			conn?.live.jukebox({
				action: 'ended',
				videoId: loadedVideo,
				anchorMs: loadedAnchor,
			});
	}

	function withApi(cb: () => void) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const w = window as any;
		if (w.YT?.Player) return cb();
		const existing = w.onYouTubeIframeAPIReady;
		w.onYouTubeIframeAPIReady = () => {
			existing?.();
			cb();
		};
		if (!document.querySelector('script[src*="iframe_api"]')) {
			const tag = document.createElement('script');
			tag.src = 'https://www.youtube.com/iframe_api';
			document.head.appendChild(tag);
		}
	}

	$effect(() => {
		const node = container;
		if (!node || player) return;
		// A blocked iframe_api (adblock, corporate DNS) must say so instead of
		// rendering a silent black tile forever (#219).
		const failTimer = setTimeout(() => {
			if (!playerReady) apiFailed = true;
		}, 8_000);
		withApi(() => {
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
						playerReady = true;
						player.setVolume?.(Math.round(mixer.music));
					},
					onStateChange: (e: { data: number }) => {
						// A state the browser granted means autoplay was not refused.
						if (e.data === PLAYING || e.data === BUFFERING)
							playerInfo.blocked = false;
						// Ended: report it WITH the play epoch — the server
						// advances exactly once per (video, epoch).
						if (e.data === ENDED) reportEnded();
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
	let releaseTimer: ReturnType<typeof setTimeout> | undefined;
	let rampTimer: ReturnType<typeof setInterval> | undefined;

	function rampTo(target: number, ms: number) {
		clearInterval(rampTimer);
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

	let wasDucked = false;
	$effect(() => {
		if (!playerReady) return;
		baseVolume = mixer.music; // the mixer owns the ceiling (#179)
		if (ducked) {
			wasDucked = true;
			clearTimeout(releaseTimer);
			rampTo(Math.round(baseVolume * mixer.duck), 150);
		} else if (wasDucked) {
			// The SPEC release: hold, then ramp back up.
			wasDucked = false;
			releaseTimer = setTimeout(() => rampTo(baseVolume, 400), 600);
		} else {
			// A fader move must act NOW — routing it through the release hold
			// made the slider feel dead (audit #219).
			player.setVolume?.(Math.round(baseVolume));
		}
		return () => {
			clearTimeout(releaseTimer);
			clearInterval(rampTimer);
		};
	});

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
		const timer = setInterval(tickChase, 250);
		// A hidden tab throttles timers while the media element keeps playing,
		// and every tick it received arrived late — so a tab coming back is
		// holding a stale playhead AND a clock estimate biased by whatever
		// its delivery was batched by. Drop the estimate so it re-learns from
		// prompt ticks, then re-measure against it.
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

	// ── Who is talking, while you are somewhere else ──────────────────────────
	// Off the room page there are no tiles, so the dock carries one face: the
	// last person to speak, beside the music (rider report).
	let lastSpeaker = $state<string | null>(null);
	$effect(() => {
		const speaking = conn?.av.speaking ?? {};
		const other = Object.keys(speaking).find(
			(id) => speaking[id] && id !== account.me?.id,
		);
		if (other) lastSpeaker = other;
	});
	const offRoom = $derived(!page.url.pathname.startsWith('/r/'));
	const speaker = $derived(
		offRoom && lastSpeaker
			? (conn?.live.tick?.roster.find((r) => r.id === lastSpeaker) ?? null)
			: null,
	);
	const speakerVideo = $derived(
		speaker ? conn?.av.videoOf[speaker.id] : undefined,
	);

	// The transport belongs on the frame too (rider report): off the room page
	// the side panel is gone, and the dock was the only thing left playing with
	// nothing to press. Every button commands the ROOM — the deck is shared.
	function transport(action: string) {
		conn?.live.jukebox({ action });
	}
	function nudge(seconds: number) {
		if (!jukebox?.current) return;
		conn?.live.jukebox({
			action: 'seek',
			positionSec: clampSeek(
				playheadAt(jukebox, serverNow(), playerInfo.duration) + seconds,
				playerInfo.duration,
			),
		});
	}

	// Proof the room is together, on the frame that is always on screen.
	const inSync = $derived(Math.abs(playerInfo.drift) <= IN_SYNC_SEC);

	const showPlayer = $derived(!!jukebox?.current);
	const title = $derived(jukebox?.current?.title ?? speaker?.name ?? '');
</script>

{#if conn}
	<!-- Until it is dragged the dock sits in the corner, clear of the side
	     panel at whatever width the rider left it, and above the chat button
	     below xl (#219). Stacking (#395): floating, it sits BELOW dialogs,
	     drawers and toasts (z-40/z-50) — RMF forbids OUR chrome over the
	     player, not a dialog the rider opened over it. Seated, it has to clear
	     the stage it sits in, and a popped-out stage is z-[55] — but not the
	     chat sheet, which is a drawer the rider opened and passes above at
	     z-[60] (#483). -->
	<div
		bind:this={shell}
		data-pane={PANE}
		data-seated={seat ? '' : undefined}
		{@attach (node) => keepSize(node, PANE)}
		{@attach (node) => (seat ? undefined : resizePane(node, PANE))}
		class="bg-surface fixed {seat
			? 'z-[56]'
			: 'z-30'} flex flex-col overflow-hidden rounded-lg {seat
			? ''
			: 'ring-ink/15 shadow-2xl ring-1'} {showPlayer || speaker
			? ''
			: 'hidden'} {page.url.pathname.startsWith('/r/')
			? 'right-4 bottom-20 xl:right-[calc(var(--pane-side-panel-w,320px)+1.25rem)] xl:bottom-4'
			: 'right-4 bottom-4'}"
		style="width: {FLOATING.w}px; height: {FLOATING.h}px; min-width: 260px;
			min-height: {200 + CHROME}px; max-width: 96vw; max-height: 90vh"
	>
		<!-- Drag handle. Chrome only — never over the player (RMF), and gone
		     entirely once the stage is holding the seat. -->
		{#if !seat}
			<div
				{@attach dragPane}
				class="border-ink/10 text-muted flex h-6 shrink-0 cursor-grab touch-none items-center gap-1.5 border-b px-2 active:cursor-grabbing"
			>
				<GripHorizontal size={12} class="shrink-0" />
				{#if showPlayer && jukebox?.playing && !playerInfo.live}
					<span
						class="h-1.5 w-1.5 shrink-0 rounded-full {inSync
							? 'bg-watt glow-stroke'
							: 'bg-muted animate-pulse'}"
						title={inSync
							? 'in sync with the room'
							: "catching up to the room's playhead"}
					></span>
				{/if}
				<span class="truncate text-[10px]">{title}</span>
				<button
					onclick={() => shell && centrePane(shell, PANE)}
					class="hover:text-ink ml-auto shrink-0"
					title="centre the dock"
					aria-label="centre the dock"><Minimize2 size={12} /></button
				>
				{#if stageSlot.popped}
					<!-- Back into the people column's deck (#445); takes effect
					     the moment a room page offers the seat again. -->
					<button
						onclick={() => setPopped(false)}
						class="hover:text-ink shrink-0"
						title="put the player back in the panel"
						aria-label="put the player back in the panel"
						><PictureInPicture2 size={12} /></button
					>
				{/if}
			</div>
		{/if}

		<div class="flex min-h-0 flex-1 bg-black">
			<!-- ≥200×200, always visible while media plays, nothing overlaid. -->
			<div class="relative min-w-0 flex-1 {showPlayer ? '' : 'hidden'}">
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

		{#if showPlayer && playerInfo.blocked}
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

		{#if showPlayer && !seat}
			<!-- Transport for the room, then your own ears (#179): the same fader
			     as the rail's mixer, where the music actually is. Below the tile —
			     RMF forbids overlays. Seated in the stage this goes away: the room
			     page has the same transport in its side panel, and a seat with
			     nothing beside the player is a seat the picture fits exactly. -->
			<div
				class="border-ink/10 text-muted flex h-8 shrink-0 items-center gap-1 border-t px-1.5"
			>
				<button
					onclick={() => transport(jukebox?.playing ? 'pause' : 'play')}
					class="hover:text-ink shrink-0 rounded p-1"
					aria-label={jukebox?.playing
						? 'pause for the room'
						: 'play for the room'}
					title={jukebox?.playing ? 'pause for the room' : 'play for the room'}
				>
					{#if jukebox?.playing}<Pause size={13} />{:else}<Play
							size={13}
						/>{/if}
				</button>
				{#if !playerInfo.live}
					<!-- A livestream has no timeline to jump around in. -->
					<button
						onclick={() => nudge(-30)}
						class="hover:text-ink shrink-0 rounded p-1"
						aria-label="back 30 seconds"
						title="back 30 seconds"><Rewind size={13} /></button
					>
					<button
						onclick={() => nudge(30)}
						class="hover:text-ink shrink-0 rounded p-1"
						aria-label="forward 30 seconds"
						title="forward 30 seconds"><FastForward size={13} /></button
					>
				{/if}
				<button
					onclick={() => transport('skip')}
					class="hover:text-ink shrink-0 rounded p-1"
					aria-label="skip for the room"
					title="skip for the room"><SkipForward size={13} /></button
				>
				<span class="bg-ink/10 mx-1 h-4 w-px shrink-0"></span>
				<Volume2 size={12} class="shrink-0" />
				<input
					type="range"
					min="0"
					max="100"
					step="5"
					value={mixer.music}
					oninput={(e) => mixer.setMusic(Number(e.currentTarget.value))}
					class="min-w-0 flex-1"
					aria-label="music volume"
				/>
			</div>
		{/if}
	</div>
{/if}
