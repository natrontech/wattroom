<script lang="ts">
	import {
		FastForward,
		PanelRight,
		Pause,
		PictureInPicture2,
		Play,
		Rewind,
		SkipForward,
		Tv,
	} from '@lucide/svelte';
	import { account } from '$lib/account.svelte';
	import { formatClockLong } from '$lib/format';
	import type { JukeboxCommand, JukeboxState } from '$lib/protocol';
	import { addYouTubeUrl, thumbnailFor } from '$lib/room/jukebox-add';
	import JukeboxTrack from '$lib/room/JukeboxTrack.svelte';
	import { IN_SYNC_SEC, playerInfo } from '$lib/room/jukebox-player.svelte';
	import { type Seat, seating, setSeat } from '$lib/room/jukebox-seat.svelte';
	import { clampSeek, playheadAt } from '$lib/room/playhead';
	import { serverNow } from '$lib/room/server-clock';

	// The jukebox PLAYLIST (#23, #216, #286): what's on, what's next, what
	// just played, and every verb for changing it. The player itself is
	// JukeboxDock, docked on the app frame so music follows the connection —
	// this component never touches an iframe.

	let {
		jukebox,
		send,
	}: {
		jukebox: JukeboxState | undefined;
		send: (command: JukeboxCommand) => void;
	} = $props();

	const current = $derived(jukebox?.current);
	const queue = $derived(jukebox?.queue ?? []);
	const history = $derived(jukebox?.history ?? []);

	// ── The transport row (#114): the room's playhead, on server time. ───────
	let nowMs = $state(serverNow());
	$effect(() => {
		if (!current) return;
		// Dead-reckon locally between ticks (docs/SPEC.md) — a 1 Hz readout
		// on a shared playhead looks broken next to the music.
		const timer = setInterval(() => (nowMs = serverNow()), 250);
		return () => clearInterval(timer);
	});
	const duration = $derived(playerInfo.duration);
	/** A livestream has no timeline to scrub — the room rides the edge. */
	const streaming = $derived(playerInfo.live);
	const elapsed = $derived(
		jukebox?.current ? playheadAt(jukebox, nowMs, duration) : 0,
	);
	const progress = $derived(
		duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0,
	);
	const inSync = $derived(Math.abs(playerInfo.drift) <= IN_SYNC_SEC);

	function seekTo(pos: number) {
		send({ action: 'seek', positionSec: clampSeek(pos, duration) });
	}
	function move(entryId: string, from: number, by: number) {
		send({ action: 'move', entryId, index: from + by });
	}

	// ── Where the picture goes (#316) ─────────────────────────────────────────
	// Listening to a track and watching a video together are the same queue and
	// different rooms: one wants the panel, the other wants the big spot above
	// the cams. The choice is the rider's and it is remembered per device.
	const SPOTS: { name: Seat; label: string; hint: string; icon: typeof Tv }[] =
		[
			{
				name: 'panel',
				label: 'panel',
				hint: 'play it here in the jukebox',
				icon: PanelRight,
			},
			{
				name: 'room',
				label: 'room',
				hint: 'play it big, above the cams',
				icon: Tv,
			},
			{
				name: 'float',
				label: 'float',
				hint: 'float it over the app',
				icon: PictureInPicture2,
			},
		];

	// ── Adding: paste a URL, the golden path ──────────────────────────────────
	let url = $state('');
	let addError = $state<string | null>(null);
	async function addFromUrl() {
		addError = null;
		if (!(await addYouTubeUrl(url, send))) {
			addError = 'That does not look like a YouTube link or video id.';
			return;
		}
		url = '';
	}
</script>

<section class="flex min-w-0 flex-col gap-3">
	<div class="flex min-w-0 items-center justify-between gap-2">
		<span class="eyebrow">jukebox</span>
		{#if current && jukebox?.playing && !streaming}
			<!-- Proof the room is together, in the one place riders look for it. -->
			<span
				class="flex shrink-0 items-center gap-1.5 font-mono text-[10px] {inSync
					? 'text-watt'
					: 'text-muted'}"
			>
				<span
					class="h-1.5 w-1.5 rounded-full {inSync
						? 'bg-watt glow-stroke'
						: 'bg-muted animate-pulse'}"
				></span>
				{inSync ? 'in sync' : 'catching up'}
			</span>
		{/if}
	</div>

	{#if current}
		<div class="flex gap-1" role="group" aria-label="where the video plays">
			{#each SPOTS as spot (spot.name)}
				{@const Icon = spot.icon}
				{@const on = seating.want === spot.name}
				<button
					onclick={() => setSeat(spot.name)}
					aria-pressed={on}
					title={spot.hint}
					class="flex flex-1 items-center justify-center gap-1 rounded border py-1.5 text-[10px] {on
						? 'border-neon text-ink'
						: 'border-muted/20 text-muted hover:text-ink'}"
				>
					<Icon size={12} />
					{spot.label}
				</button>
			{/each}
		</div>

		<div class="flex min-w-0 flex-col gap-2">
			<div class="flex min-w-0 items-start gap-2.5">
				<img
					src={thumbnailFor(current.videoId)}
					alt=""
					loading="lazy"
					referrerpolicy="no-referrer"
					class="bg-surface h-11 w-[78px] shrink-0 rounded object-cover"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm leading-tight font-medium">
						{current.title}
					</p>
					<p class="text-muted mt-0.5 truncate text-[10px]">
						added by {current.addedBy}
					</p>
				</div>
			</div>

			{#if streaming}
				<p class="text-watt text-[10px] tracking-wider uppercase">
					live · playing at the stream edge
				</p>
			{:else}
				<div class="min-w-0">
					<button
						onclick={(e) => {
							if (duration <= 0) return;
							const box = e.currentTarget.getBoundingClientRect();
							seekTo(((e.clientX - box.left) / box.width) * duration);
						}}
						class="block h-4 w-full cursor-pointer"
						aria-label="seek the room's playhead"
					>
						<span class="bg-muted/20 mt-1.5 block h-1 rounded">
							<span
								class="bg-watt relative block h-full rounded transition-[width] duration-200"
								style="width: {progress}%"
							>
								<span
									class="bg-watt glow-stroke absolute top-1/2 -right-1 h-2 w-2 -translate-y-1/2 rounded-full"
								></span>
							</span>
						</span>
					</button>
					<div
						class="text-muted flex justify-between font-mono text-[10px] tabular-nums"
					>
						<span>{formatClockLong(elapsed)}</span>
						<span>{duration > 0 ? formatClockLong(duration) : '–:––'}</span>
					</div>
				</div>
			{/if}

			<!-- Mid-ride transport: big targets, no precision gestures. Every
			     button commands the ROOM — the deck is shared. -->
			<div class="flex min-w-0 items-center gap-1.5">
				{#if !streaming}
					<button
						onclick={() => seekTo(elapsed - 30)}
						class="btn btn-secondary btn-xs min-w-0 flex-1 py-2"
						aria-label="back 30 seconds"><Rewind size={15} /></button
					>
				{/if}
				<button
					onclick={() => send({ action: jukebox?.playing ? 'pause' : 'play' })}
					class="btn btn-secondary btn-xs min-w-0 flex-1 py-2"
					aria-label={jukebox?.playing
						? 'pause for the room'
						: 'play for the room'}
				>
					{#if jukebox?.playing}<Pause size={15} />{:else}<Play
							size={15}
						/>{/if}
				</button>
				{#if !streaming}
					<button
						onclick={() => seekTo(elapsed + 30)}
						class="btn btn-secondary btn-xs min-w-0 flex-1 py-2"
						aria-label="forward 30 seconds"><FastForward size={15} /></button
					>
				{/if}
				<button
					onclick={() => send({ action: 'skip' })}
					class="btn btn-secondary btn-xs min-w-0 flex-1 py-2"
					aria-label="skip to the next track"><SkipForward size={15} /></button
				>
			</div>
		</div>
	{:else}
		<p class="text-muted text-xs leading-relaxed">
			Nothing is playing. Paste a YouTube link — everyone in the room hears it
			on the same second.
		</p>
	{/if}

	<form
		class="flex min-w-0 gap-2"
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
		<button disabled={!url.trim()} class="btn btn-primary btn-xs shrink-0"
			>Add</button
		>
	</form>
	{#if addError}<p class="text-z6 text-xs">{addError}</p>{/if}

	{#if queue.length}
		<div class="min-w-0">
			<p class="eyebrow flex items-center justify-between">
				<span>up next</span>
				<span class="font-mono">{queue.length}</span>
			</p>
			<ul class="mt-1.5 flex flex-col gap-1.5">
				{#each queue as entry, i (entry.id)}
					<JukeboxTrack
						{entry}
						position={i + 1}
						myId={account.me?.id}
						onVote={() => send({ action: 'vote', entryId: entry.id })}
						onMove={queue.length > 1
							? (by) => move(entry.id, i, by)
							: undefined}
						onRemove={() => send({ action: 'remove', entryId: entry.id })}
					/>
				{/each}
			</ul>
			<p class="text-muted/70 mt-1.5 text-[10px]">
				Votes float a track up the queue.
			</p>
		</div>
	{/if}

	{#if history.length}
		<div class="min-w-0">
			<p class="eyebrow">just played</p>
			<ul class="mt-1.5 flex flex-col gap-1.5 opacity-70">
				{#each history as entry (entry.id)}
					<JukeboxTrack
						{entry}
						onRequeue={() =>
							send({
								action: 'add',
								videoId: entry.videoId,
								title: entry.title,
							})}
					/>
				{/each}
			</ul>
		</div>
	{/if}
</section>
