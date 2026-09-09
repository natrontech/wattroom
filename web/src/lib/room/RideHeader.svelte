<script lang="ts">
	/**
	 * Slot 1 of the riding surface (ADR-0046): where you are in the work.
	 *
	 * Block *n* of *m* and its name, the seconds left in it, the bands it
	 * prescribes, what is coming next, and the clock — for a room, a solo ride
	 * and a ramp test alike. It was the room's header, inline in the Training
	 * place; the other two screens showed a fraction of it and one of them
	 * showed nothing at all about the next block.
	 *
	 * It owns no state and reads no context: `describeBlock()` builds the
	 * `Block` from the hub's tick in a room and from the local session's
	 * `TargetInfo` everywhere else, which is what makes one header possible.
	 */
	import { formatClock } from '$lib/format';
	import { blockBands, type Block } from '$lib/room/view';
	import type { Snippet } from 'svelte';

	let {
		block,
		elapsed,
		total,
		cadence = 0,
		hr = 0,
		title = '',
		unit = 'block',
		eyebrow = '',
		controls,
		aside,
	}: {
		block: Block | null;
		elapsed: number;
		total: number;
		/** Your live values, to colour the block's bands (#66, #67). */
		cadence?: number;
		hr?: number;
		/** Shown while there is no block — the workout's own name. */
		title?: string;
		/** The ramp prescribes steps, not blocks (ADR-0046). */
		unit?: string;
		/** Overrides "block n of m" where the screen counts differently — the
		 *  ramp's warm-up is segment one and is not step one. */
		eyebrow?: string;
		/** Transport: a coach's session controls, a solo rider's own. */
		controls?: Snippet;
		/** Anything the screen wants between the clock and the controls. */
		aside?: Snippet;
	} = $props();

	const bands = $derived(blockBands(block, cadence, hr));
</script>

<header class="flex flex-wrap items-end gap-x-6 gap-y-3">
	<div class="min-w-0">
		<p class="eyebrow">
			{#if eyebrow}
				{eyebrow}
			{:else if block}
				{unit}
				{block.index} of {block.count}
			{:else}
				&nbsp;
			{/if}
		</p>
		<h2 class="font-display truncate text-3xl leading-none font-bold">
			{block?.label || title}
		</h2>
	</div>
	{#if block}
		<div class="shrink-0">
			<p class="eyebrow">left in {unit}</p>
			<p class="font-display text-3xl leading-none font-bold tabular-nums">
				{formatClock(block.secondsLeft)}
			</p>
		</div>
		{#each bands as band (band.unit)}
			<!-- The block's own band (#66, #67): the work itself on a torque or a
			     zone block, coloured by your live value. -->
			<div class="shrink-0">
				<p class="eyebrow">{band.unit}</p>
				<p
					class="font-display text-3xl leading-none font-bold tabular-nums {band.inBand
						? 'text-z4'
						: 'text-muted'}"
				>
					{band.text}
				</p>
			</div>
		{/each}
		{#if block.next}
			<!-- The countdown into the next effort is a name and an absolute
			     target, never a delta: a rider at threshold should not be doing
			     arithmetic to find out what is coming (#1531). -->
			<p class="text-muted min-w-0 truncate text-xs">
				next · {block.next.label}
				{#if block.next.watts > 0}{block.next.watts} W{/if}
				for {block.next.seconds < 60
					? `${block.next.seconds} s`
					: `${Math.round(block.next.seconds / 60)} min`}
			</p>
		{/if}
	{/if}
	<p
		data-testid="ride-clock"
		class="text-muted ml-auto shrink-0 text-sm tabular-nums"
	>
		{formatClock(elapsed)}
		<span class="text-muted/50">/ {formatClock(total)}</span>
	</p>
	{@render aside?.()}
	{@render controls?.()}
</header>
