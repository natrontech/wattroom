<script lang="ts">
	/**
	 * Slot 1 over the world (TARGETS ride-road-world 6–8, v2-erg's work
	 * panel, #3668): one band above the road, in three rows at SPEC's sizes.
	 *
	 * 1. The context eyebrow — or, while one holds, the ride's status line,
	 *    which takes its place rather than a row of its own (G3) — and the
	 *    controls, one row of 44 px buttons.
	 * 2. Time left at 72 px; block, target and the clock stacked beside it;
	 *    the interval strip over NEXT and its 3-2-1 chips.
	 * 3. The trainer chip and, on a road, the road line, once.
	 *
	 * Both layouts draw this band: over the world and flat (#3670); the words are
	 * block.ts's.
	 */
	import { formatClock } from '$lib/format';
	import { roadLine } from '$lib/ride/road-readout';
	import { nextText, trainerChip, type Block } from '$lib/workout/block';
	import CountChips from '$lib/session/CountChips.svelte';
	import type { Snippet } from 'svelte';

	let {
		block,
		elapsed,
		total,
		title = '',
		unit = 'block',
		eyebrow = '',
		context = '',
		drives = false,
		wide = false,
		controls,
		status,
		strip,
		hint,
		open = false,
	}: {
		block: Block | null;
		elapsed: number;
		total: number;
		/** Shown while there is no block — the workout's own name. */
		title?: string;
		unit?: string;
		/** Overrides "unit n of m" where the screen counts differently: the ramp's warm-up is not step one. */
		eyebrow?: string;
		/** Mode · workout or road · riders (`rideContext()`). */
		context?: string;
		/** This screen drives the trainer, so the chip may say how (trainerChip). */
		drives?: boolean;
		/** Flat: slot 1 spans the page, so the strip fills what the time left leaves and the trainer chip joins NEXT's line (TARGETS ride-workout-flat 2). */
		wide?: boolean;
		controls?: Snippet;
		/** The ride's persistent status, one line with at most one button (G3). */
		status?: Snippet;
		/**
		 * The interval strip with its cursor: over the world, where it is the
		 * workout's one picture, and the ramp's. A flat ride leaves it to the
		 * graph below and sets NEXT in its place (#4159).
		 */
		strip?: Snippet;
		/** Why a control is hidden, in one line (D13: the road decides where a block ends). */
		hint?: string;
		/** No workout, the road on (#4257): `title` alone, and the big number is `elapsed`, the ride's time. */
		open?: boolean;
	} = $props();

	// 24 px words on 24 px lines: three of them stack as tall as the 72 px
	// time left, so the band ends above the corridor (the box table's 186).
	const WORDS = 'text-2xl leading-6';
	const CHIP = `${WORDS} shrink-0 border-neon/40 text-muted rounded border px-2 whitespace-nowrap`;
</script>

{#snippet trainerChipEl(b: Block)}
	<span data-testid="trainer-chip" class={CHIP}>{trainerChip(b)}</span>
{/snippet}

{#snippet nextLine(b: Block)}
	{#if b.next || (wide && drives && !b.road)}
		<!-- A name and an absolute target, never a delta (#1531, D16). Flat: its
		     own line across the header, so the text gets its full width. One
		     line (TARGETS ride-workout-flat 2): NEXT's text gives way before
		     a chip wraps, and the trainer chip stays on it when no block is
		     left. -->
		<p
			class="{WORDS} flex items-center gap-x-2 whitespace-nowrap max-sm:flex-wrap"
		>
			{#if b.next}
				<span class="ride-label">Next</span>
				<span class="min-w-0 truncate">
					{nextText(b.next)}
				</span>
				<CountChips secondsLeft={b.secondsLeft} />
			{/if}
			{#if wide && drives && !b.road}{@render trainerChipEl(b)}{/if}
		</p>
	{/if}
{/snippet}

<header data-testid="ride-band" class="flex flex-col gap-2 px-4 py-2">
	<div class="flex min-h-11 items-center gap-x-6 gap-y-2 max-sm:flex-wrap">
		<!-- The status draws its line only while one holds; the eyebrow steps
		     aside for it. -->
		<div class="group/status min-w-0 flex-1 max-sm:min-w-32">
			{@render status?.()}
			{#if context}
				<p
					data-testid="ride-context"
					class="ride-label truncate group-has-[[data-status-line]]/status:hidden"
				>
					{context}
				</p>
			{/if}
		</div>
		{#if controls}<div class="shrink-0 max-md:w-full">
				{@render controls()}
			</div>{/if}
	</div>
	{#if block}
		<div
			class="flex items-center gap-y-2 max-sm:flex-wrap {wide
				? 'gap-x-4'
				: 'gap-x-6'}"
		>
			<p
				data-testid="block-left"
				aria-label={open ? 'ridden' : `left in ${unit}`}
				class="num min-w-[4ch] shrink-0 text-7xl leading-none font-bold"
			>
				{formatClock(open ? elapsed : block.secondsLeft)}
			</p>
			<div class="{WORDS} shrink-0 whitespace-nowrap">
				<p>
					{#if open}{title}{:else if eyebrow}<span
							class="first-letter:uppercase">{eyebrow}</span
						>{:else}{unit[0].toUpperCase() + unit.slice(1)}
						<span class="num">{block.index} of {block.count}</span
						>{/if}{#if !open && (block.label || title).toLowerCase() !== eyebrow.toLowerCase()}
						{' '}· {block.label || title}{/if}
				</p>
				{#if block.band}
					<!-- Prescribed, so neon: watt is only measured live data (#3090). -->
					<p data-testid="block-target">
						Target <span class="num text-neon font-bold">{block.watts} W</span>
						· <span class="num">{block.band.low}–{block.band.high}</span>
					</p>
				{/if}
				{#if !open}<p data-testid="ride-clock" class="num text-muted">
						{formatClock(
							elapsed,
						)}{#if total > 0}{` of ${formatClock(total)}`}{/if}
					</p>{/if}
			</div>
			{#if strip || block.next || wide}
				<!-- As wide as NEXT and its chips, not as wide as the band may grow:
				     the moment card's top-centre room is what slot 1 leaves (D12). -->
				<div
					class="flex min-w-0 flex-col gap-2 {wide
						? 'flex-1 basis-60'
						: 'w-88 shrink'}"
				>
					{#if strip}<div class={wide ? 'h-14' : 'h-10'}>
							{@render strip()}
						</div>{/if}
					<!-- Flat without a strip (#4159) NEXT takes the strip's place
					     beside the clock: the graph below is the workout's picture. -->
					{#if !wide || !strip}{@render nextLine(block)}{/if}
				</div>
			{/if}
		</div>
		{#if wide && strip}{@render nextLine(block)}{/if}
	{:else}
		<h2 class="font-display truncate text-3xl leading-none font-bold">
			{title}
		</h2>
	{/if}
	{#if (drives && block && (!wide || block.road)) || block?.road || hint}
		<div class="flex items-center gap-4">
			{#if drives && block && (!wide || block.road)}{@render trainerChipEl(
					block,
				)}{/if}
			{#if block?.road}
				<!-- Where on the road, once (TARGETS one home: slot 1's road line). -->
				<p data-testid="block-road" class="num text-muted {WORDS} truncate">
					{roadLine(block.road)}
				</p>
			{/if}
			{#if hint}<p class="text-muted {WORDS} truncate">{hint}</p>{/if}
		</div>
	{/if}
</header>
