<script lang="ts">
	import { ChevronDown, ChevronUp, RotateCcw, X } from '@lucide/svelte';
	import type { JukeboxEntry } from '$lib/protocol';
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
	}: {
		entry: JukeboxEntry;
		/** 1-based slot in "up next"; absent in history. */
		position?: number;
		myId?: string;
		onVote?: () => void;
		/** −1 up, +1 down. Absent at the ends of the queue. */
		onMove?: (by: number) => void;
		onRemove?: () => void;
		onRequeue?: () => void;
	} = $props();

	const votes = $derived(entry.voters?.length ?? 0);
	const mine = $derived(!!myId && !!entry.voters?.includes(myId));
</script>

<li class="group flex items-center gap-2">
	<div class="relative shrink-0">
		<img
			src={thumbnailFor(entry.videoId)}
			alt=""
			loading="lazy"
			referrerpolicy="no-referrer"
			class="bg-surface h-9 w-16 rounded object-cover"
		/>
		{#if position}
			<span
				class="bg-paper/70 text-ink absolute bottom-0 left-0 rounded-tr px-1 font-mono text-[9px] tabular-nums"
				>{position}</span
			>
		{/if}
	</div>

	<div class="min-w-0 flex-1">
		<p class="truncate text-xs leading-tight">{entry.title}</p>
		<p class="text-muted truncate text-[10px]">{entry.addedBy}</p>
	</div>

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

	<div class="flex shrink-0 items-center">
		{#if onMove}
			<button
				onclick={() => onMove(-1)}
				aria-label="move up"
				class="text-muted hover:text-ink grid h-6 w-5 place-items-center"
				><ChevronUp size={13} /></button
			>
			<button
				onclick={() => onMove(1)}
				aria-label="move down"
				class="text-muted hover:text-ink grid h-6 w-5 place-items-center"
				><ChevronDown size={13} /></button
			>
		{/if}
		{#if onRequeue}
			<button
				onclick={onRequeue}
				aria-label="queue this again"
				class="text-muted hover:text-ink grid h-6 w-6 place-items-center"
				><RotateCcw size={13} /></button
			>
		{/if}
		{#if onRemove}
			<button
				onclick={onRemove}
				aria-label="remove from the queue"
				class="text-muted hover:text-danger grid h-6 w-6 place-items-center"
				><X size={13} /></button
			>
		{/if}
	</div>
</li>
