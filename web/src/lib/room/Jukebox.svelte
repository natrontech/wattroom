<script lang="ts">
	import type { JukeboxState } from '$lib/protocol';
	import JamCard from '$lib/room/JamCard.svelte';
	import { addYouTubeUrl } from '$lib/room/jukebox-add';
	import { mixer } from '$lib/sound/mixer.svelte';

	// The synced YouTube jukebox (#23). Hard TOS constraints (WATTROOM.md,
	// YouTube RMF): the player tile is ≥200×200, always visible while media
	// plays, and NOTHING is overlaid on it. Audio is local per rider — own
	// iframe, own volume — and never enters the voice path.

	let {
		jukebox,
		send,
		large = false,
		ducked = false,
	}: {
		jukebox: JukeboxState | undefined;
		send: (
			action: string,
			videoId?: string,
			title?: string,
			jamUrl?: string,
			positionSec?: number,
		) => void;
		large?: boolean;
		/** Someone is talking: dip the music, Discord-style (#24). */
		ducked?: boolean;
	} = $props();

	let url = $state('');
	let addError = $state<string | null>(null);
	let container = $state<HTMLDivElement | null>(null);

	// ── YouTube IFrame API ────────────────────────────────────────────────────
	// One global loader; the API script is YouTube's requirement, not a CDN whim.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type YtPlayer = any;
	let player: YtPlayer = null;
	let playerReady = $state(false);
	let loadedVideo: string | null = null;

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
		withApi(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			player = new (window as any).YT.Player(node, {
				width: '100%',
				height: '100%',
				playerVars: { playsinline: 1, rel: 0 },
				events: {
					onReady: () => (playerReady = true),
					onStateChange: (e: { data: number }) => {
						// 0 = ended: report it; the server advances exactly once.
						if (e.data === 0 && loadedVideo) send('ended', loadedVideo);
					},
					onError: () => {
						// Non-embeddable or broken: skip for everyone rather than
						// leaving each rider staring at a different error.
						if (loadedVideo) send('ended', loadedVideo);
					},
				},
			});
		});
	});

	// ── Ducking (#24, ramps per #152): client-side mix only. The rider's own
	// volume is the baseline — read when unducked, so their slider is
	// respected. SPEC numbers: dip to 25 % over 150 ms, release after a 600 ms
	// hold over 400 ms — an abrupt drop is worse than no ducking, and the hold
	// stops the level pumping on the gaps between words.
	let baseVolume = mixer.music;
	let releaseTimer: ReturnType<typeof setTimeout> | undefined;
	let rampTimer: ReturnType<typeof setInterval> | undefined;

	// The iframe API only takes integer volumes — a ramp is a stepped one.
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

	$effect(() => {
		if (!playerReady) return;
		baseVolume = mixer.music; // the mixer owns the ceiling (#179)
		if (ducked) {
			clearTimeout(releaseTimer);
			rampTo(Math.round(baseVolume * 0.25), 150);
		} else {
			releaseTimer = setTimeout(() => rampTo(baseVolume, 400), 600);
		}
		return () => {
			clearTimeout(releaseTimer);
			clearInterval(rampTimer);
		};
	});

	// ── Chase the server's playhead ───────────────────────────────────────────
	// Tiered per the issue: beyond 2 s seek, 0.3–2 s nudge playbackRate, else 1×.
	$effect(() => {
		if (!playerReady || !jukebox) return;
		const current = jukebox.current;
		if (!current) {
			if (loadedVideo) {
				player.stopVideo?.();
				loadedVideo = null;
			}
			return;
		}
		const target =
			jukebox.positionSec +
			(jukebox.playing ? (Date.now() - jukebox.anchorMs) / 1000 : 0);

		if (loadedVideo !== current.videoId) {
			loadedVideo = current.videoId;
			player.loadVideoById(current.videoId, target);
			return;
		}
		if (!jukebox.playing) {
			if (player.getPlayerState?.() === 1) player.pauseVideo();
			return;
		}
		if (player.getPlayerState?.() === 2) player.playVideo();

		const drift = target - (player.getCurrentTime?.() ?? 0);
		const abs = Math.abs(drift);
		if (abs > 2) player.seekTo(target, true);
		else if (abs > 0.3) player.setPlaybackRate(drift > 0 ? 1.25 : 0.75);
		else player.setPlaybackRate(1);
	});

	// ── The transport row (#114): shared playhead, chunky jumps, a bar for
	// desk fingers. All of it outside the iframe — RMF forbids overlays.
	let nowMs = $state(Date.now());
	let duration = $state(0);
	$effect(() => {
		if (!playerReady || !jukebox?.current) return;
		const timer = setInterval(() => {
			nowMs = Date.now();
			duration = player?.getDuration?.() || 0;
		}, 500);
		return () => clearInterval(timer);
	});
	const elapsed = $derived.by(() => {
		if (!jukebox?.current) return 0;
		const pos =
			jukebox.positionSec +
			(jukebox.playing ? (nowMs - jukebox.anchorMs) / 1000 : 0);
		return duration > 0
			? Math.min(Math.max(pos, 0), duration)
			: Math.max(pos, 0);
	});
	function fmt(sec: number): string {
		const s = Math.max(0, Math.floor(sec));
		const m = Math.floor(s / 60) % 60;
		const h = Math.floor(s / 3600);
		const two = (n: number) => String(n).padStart(2, '0');
		return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
	}
	function seekTo(pos: number) {
		const max = duration > 0 ? duration - 1 : maxSeekable;
		send(
			'seek',
			undefined,
			undefined,
			undefined,
			Math.min(Math.max(pos, 0), max),
		);
	}
	const maxSeekable = 6 * 3600; // mirrors the server clamp

	// ── Adding: paste a URL, the golden path ──────────────────────────────────
	async function addFromUrl() {
		addError = null;
		if (!(await addYouTubeUrl(url, send))) {
			addError = 'That does not look like a YouTube link or video id.';
			return;
		}
		url = '';
	}
</script>

<section class="mt-4">
	<div class="flex flex-wrap items-start gap-4">
		<!-- ≥200×200, always visible while media plays, nothing overlaid. -->
		<div
			class="bg-paper overflow-hidden rounded-lg {jukebox?.current
				? ''
				: 'hidden'}"
			style={large
				? 'width: min(100%, 712px); aspect-ratio: 16/9'
				: 'width: 356px; height: 200px'}
		>
			<div bind:this={container} class="h-full w-full"></div>
		</div>

		<div class="min-w-60 flex-1">
			<div class="flex items-center gap-2">
				<span class="text-muted text-[10px] tracking-wider uppercase"
					>jukebox</span
				>
				{#if jukebox?.current}
					<span class="truncate text-xs">{jukebox.current.title}</span>
					<button
						onclick={() => send(jukebox?.playing ? 'pause' : 'play')}
						class="border-muted/30 hover:border-muted/60 ml-auto rounded border px-2.5 py-1 text-xs"
						>{jukebox.playing ? 'Pause' : 'Play'}</button
					>
					<button
						onclick={() => send('skip')}
						class="border-muted/30 hover:border-muted/60 rounded border px-2.5 py-1 text-xs"
						>Skip</button
					>
				{/if}
			</div>

			{#if jukebox?.current}
				<div class="mt-2 flex items-center gap-2">
					<button
						onclick={() => seekTo(elapsed - 30)}
						class="border-muted/30 hover:border-muted/60 rounded border px-2.5 py-1.5 text-xs"
						aria-label="back 30 seconds">−30s</button
					>
					<div class="min-w-0 flex-1">
						<button
							onclick={(e) => {
								if (duration <= 0) return;
								const box = e.currentTarget.getBoundingClientRect();
								seekTo(((e.clientX - box.left) / box.width) * duration);
							}}
							class="group block h-4 w-full cursor-pointer"
							aria-label="seek"
						>
							<span
								class="bg-muted/20 mt-1.5 block h-1 overflow-hidden rounded"
							>
								<span
									class="bg-neon block h-full rounded transition-[width] duration-500"
									style="width: {duration > 0
										? Math.min(100, (elapsed / duration) * 100)
										: 0}%"
								></span>
							</span>
						</button>
						<div
							class="text-muted flex justify-between font-mono text-[10px] tabular-nums"
						>
							<span>{fmt(elapsed)}</span>
							<span>{duration > 0 ? fmt(duration) : '–:––'}</span>
						</div>
					</div>
					<button
						onclick={() => seekTo(elapsed + 30)}
						class="border-muted/30 hover:border-muted/60 rounded border px-2.5 py-1.5 text-xs"
						aria-label="forward 30 seconds">+30s</button
					>
				</div>
				<p class="text-muted mt-1 text-[10px]">
					added by {jukebox.current.addedBy}
				</p>
			{/if}

			<form
				class="mt-2 flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void addFromUrl();
				}}
			>
				<input
					bind:value={url}
					placeholder="Paste a YouTube link"
					class="border-muted/25 focus:border-muted/60 min-w-0 flex-1 rounded border bg-transparent px-3 py-1.5 text-xs outline-none"
				/>
				<button
					disabled={!url.trim()}
					class="bg-ink text-paper hover:bg-ink/90 rounded px-3 py-1.5 text-xs font-medium disabled:opacity-40"
					>Add</button
				>
			</form>
			{#if addError}<p class="text-z6 mt-1 text-xs">{addError}</p>{/if}

			<div class="mt-2">
				<JamCard
					jamUrl={jukebox?.jamUrl}
					onSet={(jam) => send('jam', undefined, undefined, jam)}
					onClear={() => send('jam')}
				/>
			</div>

			{#if jukebox && jukebox.queue.length > 0}
				<ul class="mt-2 grid gap-1">
					{#each jukebox.queue as entry, i (entry.videoId + i)}
						<li class="text-muted flex items-center gap-2 text-xs">
							<span class="truncate">{entry.title}</span>
							<span class="text-[10px]">· {entry.addedBy}</span>
							<button
								onclick={() => send('remove', entry.videoId)}
								class="hover:text-ink ml-auto underline">remove</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</section>
