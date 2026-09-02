<script lang="ts">
	import {
		FastForward,
		Pause,
		PictureInPicture2,
		Play,
		Plus,
		Rewind,
		SkipForward,
	} from '@lucide/svelte';
	import { account } from '$lib/account.svelte';
	import { formatClockLong } from '$lib/format';
	import type { JukeboxCommand, JukeboxState } from '$lib/protocol';
	import { addYouTubeUrl, thumbnailFor } from '$lib/room/jukebox-add';
	import JukeboxTrack from '$lib/room/JukeboxTrack.svelte';
	import { IN_SYNC_SEC, playerInfo } from '$lib/room/jukebox-player.svelte';
	import { clampSeek, playheadAt } from '$lib/room/playhead';
	import { serverNow } from '$lib/room/server-clock';
	import {
		COLUMN_SEAT,
		offerSeat,
		setPopped,
		stageSlot,
	} from '$lib/room/stage-slot.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';

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

	// The deck's own transport, as a menu (#486) — every verb still has its
	// button below. Seek stays out: it needs a position, not a click.
	function deckMenu(): MenuEntry[] {
		const playing = !!jukebox?.playing;
		return [
			{
				label: playing ? 'Pause' : 'Play',
				icon: playing ? Pause : Play,
				onSelect: () => send({ action: playing ? 'pause' : 'play' }),
			},
			{
				label: 'Skip',
				icon: SkipForward,
				onSelect: () => send({ action: 'skip' }),
			},
			'separator',
			{
				label: stageSlot.popped ? 'Put the player back' : 'Pop the player out',
				icon: PictureInPicture2,
				onSelect: () => setPopped(!stageSlot.popped),
			},
		];
	}

	// ── Adding: paste a URL, the golden path ──────────────────────────────────
	// Three lines of queue, the rest on request; history folded (#461): the
	// column is shared with the chat, and the chat loses every time.
	const QUEUE_PEEK = 3;
	// The picture belongs to whichever surface actually holds the player
	// (#489). The stage and TV mode outrank this column, and a popped-out
	// player has its own window — in both cases the deck showed a box the
	// size of a video with nothing in it, or a still of what was already on
	// screen elsewhere. Then it is words and buttons only, and it says where
	// the picture went.
	const elsewhere = $derived(
		stageSlot.popped
			? 'in the floating window'
			: (stageSlot.ownerPriority ?? COLUMN_SEAT) > COLUMN_SEAT
				? 'on the stage'
				: null,
	);
	let showAllQueue = $state(false);
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
		{#if current}
			<!-- The player sits in this deck by default (#445); popping it out is
			     the option, remembered per device. Chrome beside the player, never
			     over it (RMF). -->
			<button
				onclick={() => setPopped(!stageSlot.popped)}
				class="text-muted hover:text-ink ml-auto shrink-0 rounded p-1"
				title={stageSlot.popped
					? 'put the player back here'
					: 'pop the player out'}
				aria-label={stageSlot.popped
					? 'put the player back in the panel'
					: 'pop the player out into a floating window'}
				aria-pressed={stageSlot.popped}><PictureInPicture2 size={13} /></button
			>
		{/if}
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
		<!-- Now playing, as a deck rather than a row: the art at the column's
		     width, the title under it, the playhead under that, the transport
		     under that. One thing per line reads at arm's length; a thumbnail
		     beside a truncated title and four identical grey buttons did not. -->
		<div class="flex min-w-0 flex-col gap-2.5" {@attach contextMenu(deckMenu)}>
			{#if elsewhere}
				<p class="text-muted text-[11px]">Playing {elsewhere}.</p>
			{:else}
				<!-- The seat: the dock flies onto this hole (#445). ≥200 px tall so
				     the player clears RMF's 200×200 at the column's width; the stage
				     outranks it when the jukebox is on stage. -->
				<!-- The seat. Its height is clamped rather than tied to the panel's
				     width: a dragged-wide panel gave a 16:10 picture 300 px of
				     height and left the chat a sliver (rider report). Still ≥200 px
				     tall and wider than that, so RMF's floor holds. -->
				<div
					class="bg-surface w-full overflow-hidden rounded-lg"
					style="height: clamp(200px, 24vh, 240px)"
					{@attach (node) => offerSeat(node, COLUMN_SEAT)}
				></div>
			{/if}
			<!-- The hint sits on the words, never over the player (RMF). -->
			<div class="min-w-0" title={MENU_HINT}>
				<p class="truncate text-sm leading-tight font-medium">
					{current.title}
				</p>
				<p class="text-muted mt-0.5 truncate text-[11px]">
					queued by {current.addedBy}
				</p>
			</div>

			{#if streaming}
				<p class="text-watt text-[10px] tracking-wider uppercase">
					live · playing at the stream edge
				</p>
			{:else}
				<div class="group min-w-0">
					<button
						onclick={(e) => {
							if (duration <= 0) return;
							const box = e.currentTarget.getBoundingClientRect();
							seekTo(((e.clientX - box.left) / box.width) * duration);
						}}
						class="block w-full cursor-pointer py-1.5"
						aria-label="seek the room's playhead"
					>
						<span class="bg-muted/20 block h-1.5 rounded-full">
							<span
								class="bg-watt relative block h-full rounded-full transition-[width] duration-200"
								style="width: {progress}%"
							>
								<span
									class="bg-watt glow-stroke absolute top-1/2 -right-1.5 h-3 w-3 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
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

			<!-- Mid-ride transport: big targets, no precision gestures. Play is the
			     one filled control; the rest are quiet. Every button commands the
			     ROOM — the deck is shared. -->
			<div class="flex min-w-0 items-center justify-center gap-1">
				{#if !streaming}
					<button
						onclick={() => seekTo(elapsed - 30)}
						class="text-muted hover:text-ink grid h-10 w-10 place-items-center rounded-full"
						aria-label="back 30 seconds"><Rewind size={17} /></button
					>
				{/if}
				<button
					onclick={() => send({ action: jukebox?.playing ? 'pause' : 'play' })}
					class="bg-ink text-paper hover:bg-ink/90 grid h-11 w-11 place-items-center rounded-full"
					aria-label={jukebox?.playing
						? 'pause for the room'
						: 'play for the room'}
				>
					{#if jukebox?.playing}<Pause size={18} />{:else}<Play
							size={18}
							class="translate-x-px"
						/>{/if}
				</button>
				{#if !streaming}
					<button
						onclick={() => seekTo(elapsed + 30)}
						class="text-muted hover:text-ink grid h-10 w-10 place-items-center rounded-full"
						aria-label="forward 30 seconds"><FastForward size={17} /></button
					>
				{/if}
				<button
					onclick={() => send({ action: 'skip' })}
					class="text-muted hover:text-ink grid h-10 w-10 place-items-center rounded-full"
					aria-label="skip to the next track"><SkipForward size={17} /></button
				>
			</div>
		</div>
	{:else}
		<p class="text-muted text-xs leading-relaxed">
			Nothing is playing. Paste a YouTube link — or drop one in the chat and
			queue it from there — and everyone hears it on the same second.
		</p>
	{/if}

	<form
		class="flex min-w-0 gap-1.5"
		onsubmit={(e) => {
			e.preventDefault();
			void addFromUrl();
		}}
	>
		<input
			bind:value={url}
			placeholder="Add a YouTube link…"
			class="input input-xs min-w-0 flex-1"
			aria-label="add a track by link"
		/>
		<button
			disabled={!url.trim()}
			class="btn btn-secondary btn-xs shrink-0 disabled:opacity-40"
			aria-label="add to the queue"><Plus size={14} /></button
		>
	</form>
	{#if addError}<p class="text-danger text-xs">{addError}</p>{/if}

	{#if queue.length}
		<div class="min-w-0">
			<p class="eyebrow flex items-center justify-between">
				<span>up next</span>
				<span class="font-mono">{queue.length}</span>
			</p>
			<ul class="mt-1.5 flex flex-col gap-1.5">
				{#each queue.slice(0, showAllQueue ? queue.length : QUEUE_PEEK) as entry, i (entry.id)}
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
			{#if queue.length > QUEUE_PEEK}
				<button
					onclick={() => (showAllQueue = !showAllQueue)}
					class="text-muted hover:text-ink mt-1.5 text-[11px] underline"
					>{showAllQueue
						? 'fewer'
						: `+${queue.length - QUEUE_PEEK} more`}</button
				>
			{/if}
			<p class="text-muted/70 mt-1.5 text-[10px]">
				Votes float a track up the queue.
			</p>
		</div>
	{/if}

	{#if history.length}
		<details class="min-w-0">
			<summary class="eyebrow cursor-pointer select-none"
				>just played · {history.length}</summary
			>
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
		</details>
	{/if}
</section>
