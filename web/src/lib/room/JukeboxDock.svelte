<script lang="ts">
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { chase } from '$lib/room/chase';
	import { playerInfo } from '$lib/room/jukebox-player.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { GripHorizontal, Minimize2, Volume2 } from '@lucide/svelte';

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
	// Min size is the RMF floor plus the two chrome strips, so the player
	// itself can never be dragged below 200×200.
	const CHROME = 52;
	const MIN_W = 224;
	const MIN_H = 200 + CHROME;
	const DOCK_KEY = 'wattroom.dock.v1';
	interface Box {
		x: number;
		y: number;
		w: number;
		h: number;
	}
	let box = $state<Box | null>(null);

	function clamp(next: Box): Box {
		const w = Math.max(MIN_W, Math.min(next.w, window.innerWidth));
		const h = Math.max(MIN_H, Math.min(next.h, window.innerHeight));
		return {
			w,
			h,
			x: Math.max(0, Math.min(next.x, window.innerWidth - w)),
			y: Math.max(0, Math.min(next.y, window.innerHeight - h)),
		};
	}
	function save() {
		try {
			localStorage.setItem(DOCK_KEY, JSON.stringify(box));
		} catch {
			// placement is a convenience; a blocked store costs only the memory
		}
	}
	function defaults(): Box {
		const w = 380;
		const h = 252;
		// Clear of the side panel on a wide screen, and of the chat button below it.
		return clamp({
			w,
			h,
			x: window.innerWidth - w - (window.innerWidth >= 1280 ? 340 : 16),
			y: window.innerHeight - h - 16,
		});
	}
	$effect(() => {
		if (box) return;
		try {
			const saved = JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null');
			box = saved ? clamp(saved) : defaults();
		} catch {
			box = defaults();
		}
	});

	function drag(event: PointerEvent) {
		if (!box) return;
		const handle = event.currentTarget as HTMLElement;
		const from = { px: event.clientX, py: event.clientY, x: box.x, y: box.y };
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			// no capture: the drag still tracks while the pointer is over the handle
		}
		const move = (moved: PointerEvent) => {
			box = clamp({
				...box!,
				x: from.x + moved.clientX - from.px,
				y: from.y + moved.clientY - from.py,
			});
		};
		const done = () => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', done);
			handle.removeEventListener('pointercancel', done);
			save();
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', done);
		handle.addEventListener('pointercancel', done);
	}

	function centre() {
		if (!box) return;
		box = clamp({
			...box,
			x: (window.innerWidth - box.w) / 2,
			y: (window.innerHeight - box.h) / 2,
		});
		save();
	}

	// The corner handle is the browser's own (CSS resize) — this only records
	// where the rider left it.
	$effect(() => {
		const node = shell;
		if (!node) return;
		const observer = new ResizeObserver(() => {
			const w = node.offsetWidth;
			const h = node.offsetHeight;
			if (!box || w < MIN_W || h < MIN_H) return; // hidden dock reads 0
			if (w === box.w && h === box.h) return;
			box = { ...box, w, h };
			save();
		});
		observer.observe(node);
		return () => observer.disconnect();
	});

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
			rampTo(Math.round(baseVolume * 0.25), 150);
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

	const showPlayer = $derived(!!jukebox?.current);
	const title = $derived(jukebox?.current?.title ?? speaker?.name ?? '');
</script>

<svelte:window onresize={() => box && (box = clamp(box))} />

{#if conn && box}
	<div
		bind:this={shell}
		class="bg-surface ring-ink/15 fixed z-[60] flex flex-col overflow-hidden rounded-lg shadow-2xl ring-1 {showPlayer ||
		speaker
			? ''
			: 'hidden'}"
		style="left: {box.x}px; top: {box.y}px; width: {box.w}px; height: {box.h}px;
			min-width: {MIN_W}px; min-height: {MIN_H}px; resize: both"
	>
		<!-- Drag handle. Chrome only — never over the player (RMF). -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			onpointerdown={drag}
			class="border-ink/10 text-muted flex h-6 shrink-0 cursor-move touch-none items-center gap-1.5 border-b px-2"
		>
			<GripHorizontal size={12} class="shrink-0" />
			<span class="truncate text-[10px]">{title}</span>
			<button
				onclick={centre}
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
			<!-- Your ears only (#179): the same fader as the rail's mixer, where
			     the music actually is. Below the tile — RMF forbids overlays. -->
			<div class="flex h-7 shrink-0 items-center gap-2 px-2">
				<Volume2 size={12} class="text-muted shrink-0" />
				<input
					type="range"
					min="0"
					max="100"
					step="5"
					value={mixer.music}
					oninput={(e) => mixer.setMusic(Number(e.currentTarget.value))}
					class="w-full"
					aria-label="music volume"
				/>
			</div>
		{/if}
	</div>
{/if}
