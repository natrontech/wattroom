<script lang="ts">
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { chase, clampSeek, playheadAt } from '$lib/room/playhead';
	import { playerInfo } from '$lib/room/jukebox-player.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { centrePane, dragPane, keepSize } from '$lib/pane';
	import {
		FastForward,
		GripHorizontal,
		Minimize2,
		Pause,
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
	// never be centred"): drag the handle, drag the corner to resize, and both
	// survive navigation and reload.

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

	// ── YouTube IFrame API ────────────────────────────────────────────────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type YtPlayer = any;
	let player: YtPlayer = null;
	let playerReady = $state(false);
	let apiFailed = $state(false);
	let loadedVideo: string | null = null;
	/** A livestream has no shared playhead to chase — everyone rides the edge. */
	let streaming = false;

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
						// 0 = ended: report it WITH the play epoch — the server
						// advances exactly once per (video, epoch).
						if (e.data === 0 && loadedVideo)
							conn?.live.jukebox(
								'ended',
								loadedVideo,
								undefined,
								undefined,
								undefined,
								conn?.live.tick?.jukebox?.anchorMs,
							);
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
						if (loadedVideo)
							conn?.live.jukebox(
								'ended',
								loadedVideo,
								undefined,
								undefined,
								undefined,
								conn?.live.tick?.jukebox?.anchorMs,
							);
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

	// ── Chase the server's playhead (tiered per the issue). ──────────────────
	$effect(() => {
		if (!playerReady) return;
		if (conn?.live.status !== 'live') {
			// No ticks, no chase: a stuck 1.25× nudge is worse than drift.
			player.setPlaybackRate?.(1);
			return;
		}
		if (!jukebox) return;
		const current = jukebox.current;
		if (!current) {
			if (loadedVideo) {
				player.stopVideo?.();
				loadedVideo = null;
				streaming = false;
				playerInfo.duration = 0;
				playerInfo.live = false;
			}
			return;
		}
		const target =
			jukebox.positionSec +
			(jukebox.playing ? (Date.now() - jukebox.anchorMs) / 1000 : 0);

		if (loadedVideo !== current.videoId) {
			loadedVideo = current.videoId;
			streaming = false;
			playerInfo.live = false;
			player.loadVideoById(current.videoId, target);
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
		if (streaming) {
			const edge = chase(target, player.getCurrentTime?.() ?? 0, true);
			if (edge.do === 'rate') player.setPlaybackRate?.(edge.rate);
			if (!jukebox.playing) {
				if (player.getPlayerState?.() === 1) player.pauseVideo();
			} else if (player.getPlayerState?.() === 2) player.playVideo();
			return;
		}

		playerInfo.duration = player.getDuration?.() || 0;
		if (!jukebox.playing) {
			if (player.getPlayerState?.() === 1) player.pauseVideo();
			return;
		}
		if (player.getPlayerState?.() === 2) player.playVideo();

		const next = chase(target, player.getCurrentTime?.() ?? 0, false);
		if (next.do === 'seek') player.seekTo(next.to, true);
		else player.setPlaybackRate(next.rate);
	});

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
		conn?.live.jukebox(action);
	}
	function nudge(seconds: number) {
		if (!jukebox?.current) return;
		conn?.live.jukebox(
			'seek',
			undefined,
			undefined,
			undefined,
			clampSeek(
				playheadAt(jukebox, Date.now(), playerInfo.duration) + seconds,
				playerInfo.duration,
			),
		);
	}

	const showPlayer = $derived(!!jukebox?.current);
	const title = $derived(jukebox?.current?.title ?? speaker?.name ?? '');
</script>

{#if conn}
	<!-- Until it is dragged the dock sits in the corner, clear of the side
	     panel at whatever width the rider left it, and above the chat button
	     the z-[60] dock would otherwise bury below xl (#219). -->
	<div
		bind:this={shell}
		data-pane={PANE}
		{@attach (node) => keepSize(node, PANE)}
		class="bg-surface ring-ink/15 fixed z-[60] flex flex-col overflow-hidden rounded-lg shadow-2xl ring-1 {showPlayer ||
		speaker
			? ''
			: 'hidden'} {page.url.pathname.startsWith('/r/')
			? 'right-4 bottom-20 xl:right-[calc(var(--pane-side-panel-w,320px)+1.25rem)] xl:bottom-4'
			: 'right-4 bottom-4'}"
		style="width: 380px; height: {252 + CHROME}px; min-width: 260px;
			min-height: {200 + CHROME}px; max-width: 96vw; max-height: 90vh;
			resize: both"
	>
		<!-- Drag handle. Chrome only — never over the player (RMF). -->
		<div
			{@attach dragPane}
			class="border-ink/10 text-muted flex h-6 shrink-0 cursor-grab touch-none items-center gap-1.5 border-b px-2 active:cursor-grabbing"
		>
			<GripHorizontal size={12} class="shrink-0" />
			<span class="truncate text-[10px]">{title}</span>
			<button
				onclick={() => shell && centrePane(shell, PANE)}
				class="hover:text-ink ml-auto shrink-0"
				title="centre the dock"
				aria-label="centre the dock"><Minimize2 size={12} /></button
			>
		</div>

		<div class="flex min-h-0 flex-1 bg-black">
			{#if speaker}
				{@const id = speaker.id}
				<div class="border-ink/10 relative w-24 shrink-0 border-r">
					{#if speakerVideo}
						{#key speakerVideo}
							<div
								class="h-full w-full"
								{@attach (node) => conn?.av.attach(id, node)}
							></div>
						{/key}
					{:else}
						<div class="bg-surface-raised grid h-full place-items-center">
							<Avatar name={speaker.name} size={32} />
						</div>
					{/if}
					<span
						class="bg-paper/70 text-ink absolute inset-x-0 bottom-0 truncate px-1 text-[9px]"
						>{speaker.name}</span
					>
				</div>
			{/if}
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

		{#if showPlayer}
			<!-- Transport for the room, then your own ears (#179): the same fader
			     as the rail's mixer, where the music actually is. Below the tile —
			     RMF forbids overlays. -->
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
