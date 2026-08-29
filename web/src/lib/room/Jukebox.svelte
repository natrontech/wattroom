<script lang="ts">
	import type { JukeboxState } from '$lib/protocol';

	// The synced YouTube jukebox (#23). Hard TOS constraints (WATTROOM.md,
	// YouTube RMF): the player tile is ≥200×200, always visible while media
	// plays, and NOTHING is overlaid on it. Audio is local per rider — own
	// iframe, own volume — and never enters the voice path.

	let {
		jukebox,
		send,
	}: {
		jukebox: JukeboxState | undefined;
		send: (action: string, videoId?: string, title?: string) => void;
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

	// ── Adding: paste a URL, the golden path ──────────────────────────────────
	function videoIdFrom(input: string): string | null {
		const trimmed = input.trim();
		if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
		try {
			const u = new URL(trimmed);
			const v = u.searchParams.get('v');
			if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
			const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
			if (/^[A-Za-z0-9_-]{11}$/.test(last)) return last;
		} catch {
			/* not a URL */
		}
		return null;
	}

	async function addFromUrl() {
		addError = null;
		const videoId = videoIdFrom(url);
		if (!videoId) {
			addError = 'That does not look like a YouTube link or video id.';
			return;
		}
		// oEmbed is keyless and gives the title; failing it costs only the label.
		let title = videoId;
		try {
			const res = await fetch(
				`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
			);
			if (res.ok) title = (await res.json()).title ?? videoId;
		} catch {
			/* title stays the id */
		}
		send('add', videoId, title);
		url = '';
	}
</script>

<section class="mt-4">
	<div class="flex flex-wrap items-start gap-4">
		<!-- ≥200×200, always visible while media plays, nothing overlaid. -->
		<div
			class="overflow-hidden rounded-lg bg-black {jukebox?.current
				? ''
				: 'hidden'}"
			style="width: 356px; height: 200px"
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
					class="rounded bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90 disabled:opacity-40"
					>Add</button
				>
			</form>
			{#if addError}<p class="text-z6 mt-1 text-xs">{addError}</p>{/if}

			{#if jukebox && jukebox.queue.length > 0}
				<ul class="mt-2 grid gap-1">
					{#each jukebox.queue as entry, i (entry.videoId + i)}
						<li class="text-muted flex items-center gap-2 text-xs">
							<span class="truncate">{entry.title}</span>
							<span class="text-[10px]">· {entry.addedBy}</span>
							<button
								onclick={() => send('remove', entry.videoId)}
								class="ml-auto underline hover:text-white">remove</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</section>
