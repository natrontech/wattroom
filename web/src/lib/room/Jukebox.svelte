<script lang="ts">
	import { Pause, Play, SkipForward } from '@lucide/svelte';
	import { formatClockLong } from '$lib/format';
	import type { JukeboxState } from '$lib/protocol';
	import JamCard from '$lib/room/JamCard.svelte';
	import { addYouTubeUrl } from '$lib/room/jukebox-add';
	import { playerInfo } from '$lib/room/jukebox-player.svelte';

	// The jukebox CONTROLS (#23, #216): transport, queue, adding. The player
	// itself is JukeboxDock, docked on the app frame so music follows the
	// connection — this component never touches an iframe.

	let {
		jukebox,
		send,
	}: {
		jukebox: JukeboxState | undefined;
		send: (
			action: string,
			videoId?: string,
			title?: string,
			jamUrl?: string,
			positionSec?: number,
		) => void;
	} = $props();

	let url = $state('');
	let addError = $state<string | null>(null);

	// ── The transport row (#114): shared playhead, chunky jumps. ─────────────
	let nowMs = $state(Date.now());
	$effect(() => {
		if (!jukebox?.current) return;
		const timer = setInterval(() => (nowMs = Date.now()), 500);
		return () => clearInterval(timer);
	});
	const duration = $derived(playerInfo.duration);
	/** A livestream has no timeline to scrub — the room rides the edge. */
	const streaming = $derived(playerInfo.live);
	const elapsed = $derived.by(() => {
		if (!jukebox?.current) return 0;
		const pos =
			jukebox.positionSec +
			(jukebox.playing ? (nowMs - jukebox.anchorMs) / 1000 : 0);
		return duration > 0
			? Math.min(Math.max(pos, 0), duration)
			: Math.max(pos, 0);
	});
	const maxSeekable = 6 * 3600; // mirrors the server clamp
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
		<div class="min-w-60 flex-1">
			<div class="flex items-center gap-2">
				<span class="eyebrow">jukebox</span>
				{#if jukebox?.current}
					<span class="truncate text-xs">{jukebox.current.title}</span>
					<button
						onclick={() => send(jukebox?.playing ? 'pause' : 'play')}
						class="btn btn-secondary btn-xs ml-auto"
						aria-label={jukebox.playing ? 'pause' : 'play'}
					>
						{#if jukebox.playing}<Pause size={13} />{:else}<Play
								size={13}
							/>{/if}
					</button>
					<button
						onclick={() => send('skip')}
						class="btn btn-secondary btn-xs"
						aria-label="skip"><SkipForward size={13} /></button
					>
				{/if}
			</div>

			{#if jukebox?.current && streaming}
				<p class="text-watt mt-2 text-[10px] tracking-wider uppercase">
					live · playing at the stream edge
				</p>
				<p class="text-muted mt-1 text-[10px]">
					added by {jukebox.current.addedBy}
				</p>
			{:else if jukebox?.current}
				<div class="mt-2 flex items-center gap-2">
					<button
						onclick={() => seekTo(elapsed - 30)}
						class="btn btn-secondary btn-xs"
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
							<span>{formatClockLong(elapsed)}</span>
							<span>{duration > 0 ? formatClockLong(duration) : '–:––'}</span>
						</div>
					</div>
					<button
						onclick={() => seekTo(elapsed + 30)}
						class="btn btn-secondary btn-xs"
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
					class="input input-xs min-w-0 flex-1"
				/>
				<button disabled={!url.trim()} class="btn btn-primary btn-xs"
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

			{#if jukebox?.queue?.length}
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
