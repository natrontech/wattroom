<script lang="ts">
	/**
	 * Slot 1 of the riding surface (ADR-0046): where you are in the work.
	 *
	 * Block *n* of *m* and its name, the seconds left in it, the bands it
	 * prescribes, what is coming next, and the clock — for a session, a solo
	 * ride and a ramp test alike. It was the session's header, inline in the
	 * Training place; the other two screens showed a fraction of it and one of
	 * them showed nothing at all about the next block.
	 *
	 * It owns no state and reads no context: `describeBlock()` builds the
	 * `Block` from the hub's tick in a voice channel and from the local
	 * session's `TargetInfo` everywhere else, which is what makes one header
	 * possible.
	 */
	import { formatClock } from '$lib/format';
	import { blockBands, type Block } from '$lib/workout/block';
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
		erg = false,
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
		/**
		 * This screen's trainer is holding the targets in ERG, so the header
		 * may say so (#3090). Off where nothing is paired, or another of the
		 * rider's screens holds it: a chip naming a mode no trainer is in is
		 * a claim, not a fact.
		 */
		erg?: boolean;
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
				{block.index} of {block.count}{#if block.rep}
					· rep {block.rep.index} of {block.rep.count}{/if}
			{:else}
				&nbsp;
			{/if}
		</p>
		<h2 class="font-display truncate text-3xl leading-none font-bold">
			{block?.label || title}
		</h2>
	</div>
	{#if block}
		<!-- Time left is the figure a rider looks up for (#3090): the largest
		     thing in the header, 72 px on a desk. -->
		<div class="shrink-0">
			<p class="eyebrow">left in {unit}</p>
			<p
				data-testid="block-left"
				class="num text-5xl leading-none font-bold md:text-7xl"
			>
				{formatClock(block.secondsLeft)}
			</p>
		</div>
		{#if block.band}
			<!-- Prescribed, so neon: watt is only ever measured live data (round
			     4, #3090). The band is execution's own — on target means inside it. -->
			<div class="shrink-0">
				<p class="eyebrow flex items-center gap-2">
					target
					{#if erg}<span
							class="border-neon/40 text-muted rounded border px-2 leading-tight tracking-normal normal-case"
							>ERG {block.watts} W</span
						>{/if}
				</p>
				<p
					data-testid="block-target"
					class="num text-neon text-3xl leading-none font-bold"
				>
					{block.watts} W · {block.band.low}–{block.band.high}
				</p>
			</div>
		{/if}
		{#each bands as band (band.unit)}
			<!-- The block's own band (#66, #67): the work itself on a torque or a
			     zone block, coloured by your live value. -->
			<div class="shrink-0">
				<p class="eyebrow">{band.unit}</p>
				<p
					class="font-display text-3xl leading-none font-bold tabular-nums {band.inBand
						? 'text-ok'
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
			<p class="text-muted max-w-full min-w-0 truncate text-2xl">
				next · {block.next.label}
				{#if block.next.watts > 0}<span class="num text-neon"
						>{block.next.watts} W</span
					>{/if}
				for {block.next.seconds < 60
					? `${block.next.seconds} s`
					: `${Math.round(block.next.seconds / 60)} min`}
			</p>
		{/if}
		{#if block.last}
			<!-- The block just ridden, for its first seconds: measured, so ink,
			     never the prescribed neon. -->
			<p data-testid="last-block" class="text-muted basis-full text-sm">
				last block <span class="num text-ink">{block.last.watts} W</span> ·
				<span class="num text-ink">{block.last.onTarget} %</span> on target
			</p>
		{/if}
	{/if}
	<p
		data-testid="ride-clock"
		class="text-muted ml-auto shrink-0 text-sm tabular-nums"
	>
		{formatClock(elapsed)}
		<!-- A game's session has no length to count toward (#2597). -->
		{#if total > 0}<span class="text-muted-dim">/ {formatClock(total)}</span
			>{/if}
	</p>
	{@render aside?.()}
	{@render controls?.()}
</header>
