<script lang="ts">
	import { contextMenu, type MenuEntry } from '$lib/context-menu.svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Music from '@lucide/svelte/icons/music';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import ListMusic from '@lucide/svelte/icons/list-music';
	import type { JukeboxEntry } from '$lib/protocol';
	import type { SaveTarget } from '$lib/room/playlists.svelte';
	import { fitsCadence } from '$lib/room/cadence-fit';
	import { thumbnailFor } from '$lib/room/jukebox-add';

	// One track in the playlist (#286) — the same row for what's next and for
	// what just played, because they differ only in which verbs apply.
	let {
		entry,
		position,
		myId,
		onVote,
		onMove,
		onRemove,
		onRequeue,
		saveTargets = [],
		onSave,
		targetRpm = 0,
	}: {
		entry: JukeboxEntry;
		/** 1-based slot in "up next"; absent in history. */
		position?: number;
		myId?: string;
		onVote?: () => void;
		/** −1 up, +1 down. Reached from the context menu only (#661): the row
		 *  is too narrow for bike-sized arrows beside a readable title, and
		 *  the vote button is the one-tap way to float a track up. */
		onMove?: (by: number) => void;
		onRemove?: () => void;
		onRequeue?: () => void;
		/** Where "Save to …" can put this entry (#1427): the room's playlists
		 *  and the rider's own. Empty offers one disabled line saying so. */
		saveTargets?: SaveTarget[];
		onSave?: (target: SaveTarget) => void;
		/** The rpm the running block asks for (#1431); 0 outside a session. */
		targetRpm?: number;
	} = $props();

	const fits = $derived(fitsCadence(entry.bpm, targetRpm));

	const votes = $derived(entry.voters?.length ?? 0);
	const mine = $derived(!!myId && !!entry.voters?.includes(myId));

	// A playlist is one row that happens to contain tracks (#615) — it votes,
	// moves and is removed as one thing, which is what keeps a paste from
	// owning the room's fifty slots. Its contents fold open on request.
	const tracks = $derived(entry.tracks ?? []);
	let open = $state(false);
</script>

<li
	class="group min-w-0"
	{@attach contextMenu(() => {
		const entries: MenuEntry[] = [];
		if (tracks.length)
			entries.push({
				label: open ? 'Hide the tracks' : `Show all ${tracks.length} tracks`,
				icon: open ? ChevronUp : ChevronDown,
				onSelect: () => (open = !open),
			});
		if (onVote)
			entries.push({ label: 'Vote it up', icon: ThumbsUp, onSelect: onVote });
		if (onMove) {
			entries.push(
				{ label: 'Move up', icon: ArrowUp, onSelect: () => onMove(-1) },
				{ label: 'Move down', icon: ArrowDown, onSelect: () => onMove(1) },
			);
		}
		if (onRequeue)
			entries.push({
				label: 'Play again',
				icon: RotateCcw,
				onSelect: onRequeue,
			});
		if (onSave) {
			// One line per playlist rather than a submenu the kit does not
			// have: a room keeps a handful, and a rider mid-ride reads names,
			// not chevrons.
			if (entries.length) entries.push('separator');
			if (saveTargets.length)
				for (const target of saveTargets)
					entries.push({
						label: `Save to “${target.name}”`,
						icon: ListMusic,
						hint: target.kind === 'mine' ? 'yours' : undefined,
						onSelect: () => onSave(target),
					});
			else
				entries.push({
					label: 'Save to a playlist',
					icon: ListMusic,
					disabled: true,
					hint: 'none yet',
					onSelect: () => {},
				});
		}
		if (onRemove)
			entries.push('separator', {
				label: 'Remove',
				icon: Trash2,
				onSelect: onRemove,
				danger: true,
			});
		return entries;
	})}
>
	<div class="flex min-w-0 items-center gap-2">
		<div class="relative shrink-0">
			{#if entry.trackId}
				<!-- A pool track has no thumbnail to show and needs none: the
				     mark says "this one is audio" at a glance (#267). -->
				<div
					class="bg-surface text-muted grid h-9 w-16 place-items-center rounded"
				>
					<Music size={14} />
				</div>
			{:else}
				<img
					src={thumbnailFor(entry.videoId)}
					alt=""
					loading="lazy"
					referrerpolicy="no-referrer"
					class="bg-surface h-9 w-16 rounded object-cover"
				/>
			{/if}
			{#if position}
				<span
					class="bg-paper/70 text-ink absolute bottom-0 left-0 rounded-tr px-1 font-mono text-[9px] tabular-nums"
					>{position}</span
				>
			{/if}
			{#if tracks.length}
				<!-- The stack says "more than one" before any words do. -->
				<span
					class="border-neon/50 bg-paper/80 text-muted absolute right-0 bottom-0 rounded-tl border-t border-l px-1 font-mono text-[9px] tabular-nums"
					>{tracks.length}</span
				>
			{/if}
		</div>

		<div class="min-w-0 flex-1">
			<p class="truncate text-xs leading-tight">
				{tracks.length ? entry.playlistTitle : entry.title}
			</p>
			<p class="text-muted truncate text-[10px]">
				{#if tracks.length}
					playlist · {tracks.length} tracks · {entry.addedBy}
				{:else if entry.artist}
					<!-- The artist is what a rider recognises a pool track by;
					     who queued it still follows, as on every other row. -->
					{entry.artist} · {entry.addedBy}
				{:else}
					{entry.addedBy}
				{/if}
				{#if entry.bpm}
					<!-- Tempo, and whether it fits the block (#1431): the mark is
					     live data — it follows the timeline — so it takes the
					     watt hue, the number stays quiet. -->
					· <span class="font-mono tabular-nums">{entry.bpm} bpm</span>
					{#if fits}<span class="text-watt">· fits the block</span>{/if}
				{/if}
			</p>
		</div>

		{#if tracks.length}
			<button
				onclick={() => (open = !open)}
				aria-expanded={open}
				aria-label={open ? 'hide the tracks' : 'show the tracks'}
				class="text-muted hover:text-ink grid h-9 w-6 shrink-0 place-items-center"
			>
				{#if open}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
			</button>
		{/if}

		{#if onVote}
			<!-- The mid-ride verb: one big target, no precision needed (ux.md). -->
			<button
				onclick={onVote}
				aria-pressed={mine}
				aria-label={mine ? 'remove your vote' : 'vote for this track'}
				class="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded border {mine
					? 'border-neon bg-neon/15 text-ink'
					: 'border-muted/20 text-muted hover:border-muted/50'}"
			>
				<ChevronUp size={12} />
				<span class="font-mono text-[10px] leading-none tabular-nums"
					>{votes}</span
				>
			</button>
		{/if}

		<!-- The same footprint as the transport above (ux.md: huge tap targets
		     mid-ride). One verb per row — remove here, play again in history. -->
		{#if onRequeue}
			<button
				onclick={onRequeue}
				aria-label="queue this again"
				class="text-muted hover:text-ink icon-btn"
				><RotateCcw size={15} /></button
			>
		{/if}
		{#if onRemove}
			<button
				onclick={onRemove}
				aria-label="remove from the queue"
				class="text-muted hover:text-danger icon-btn"><X size={15} /></button
			>
		{/if}
	</div>

	{#if tracks.length && open}
		<!-- What is inside the set, in the order it will play. No per-track
		     verbs: a queued playlist is one thing, and pretending a track can
		     be pulled out of it would be a button that fails (errors.md). -->
		<ol
			class="border-muted/20 text-muted mt-1.5 ml-4 flex flex-col gap-1 border-l pl-3 text-[10px]"
		>
			{#each tracks as track, i (track.videoId + i)}
				<li class="flex min-w-0 gap-1.5">
					<span class="shrink-0 font-mono tabular-nums">{i + 1}</span>
					<span class="truncate">{track.title}</span>
				</li>
			{/each}
		</ol>
	{/if}
</li>
