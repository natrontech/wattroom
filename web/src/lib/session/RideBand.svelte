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
	 * RideHeader is the same slot on the flat surface; the words are theirs
	 * (block.ts), only the arrangement is this band's.
	 */
	import { formatClock } from '$lib/format';
	import { roadLine } from '$lib/ride/road-readout';
	import { nextFor, trainerChip, type Block } from '$lib/workout/block';
	import type { Snippet } from 'svelte';

	let {
		block,
		elapsed,
		total,
		title = '',
		unit = 'block',
		context = '',
		drives = false,
		controls,
		status,
		strip,
		hint,
	}: {
		block: Block | null;
		elapsed: number;
		total: number;
		/** Shown while there is no block — the workout's own name. */
		title?: string;
		unit?: string;
		/** Mode · workout or road · riders (`rideContext()`). */
		context?: string;
		/** This screen drives the trainer, so the chip may say how (RideHeader). */
		drives?: boolean;
		controls?: Snippet;
		/** The ride's persistent status, one line with at most one button (G3). */
		status?: Snippet;
		/** The interval strip with its cursor. */
		strip?: Snippet;
		/** Why a control is hidden, in one line (D13: the road decides where a block ends). */
		hint?: string;
	} = $props();

	// 24 px words on 24 px lines: three of them stack as tall as the 72 px
	// time left, so the band ends above the corridor (the box table's 186).
	const WORDS = 'text-2xl leading-6';
	const CHIP = `${WORDS} border-neon/40 text-muted rounded border px-2 whitespace-nowrap`;
	// The last three seconds of a block light their chip (v2-erg's 3-2-1).
	const counting = $derived(
		block?.next ? Math.ceil(block.secondsLeft) : Infinity,
	);
</script>

<header data-testid="ride-band" class="flex flex-col gap-2 px-4 py-2">
	<div class="flex min-h-11 items-center gap-6">
		<!-- The status draws its line only while one holds; the eyebrow steps
		     aside for it. -->
		<div class="group/status min-w-0 flex-1">
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
		{#if controls}<div class="shrink-0">{@render controls()}</div>{/if}
	</div>
	{#if block}
		<div class="flex items-center gap-6">
			<p
				data-testid="block-left"
				aria-label="left in {unit}"
				class="num min-w-[4.5ch] shrink-0 text-7xl leading-none font-bold"
			>
				{formatClock(block.secondsLeft)}
			</p>
			<div class="{WORDS} shrink-0 whitespace-nowrap">
				<p>
					{unit[0].toUpperCase() + unit.slice(1)}
					<span class="num">{block.index} of {block.count}</span> · {block.label ||
						title}
				</p>
				{#if block.band}
					<!-- Prescribed, so neon: watt is only measured live data (#3090). -->
					<p data-testid="block-target">
						Target <span class="num text-neon font-bold">{block.watts} W</span>
						· <span class="num">{block.band.low}–{block.band.high}</span>
					</p>
				{/if}
				<p data-testid="ride-clock" class="num text-muted">
					{formatClock(
						elapsed,
					)}{#if total > 0}{` of ${formatClock(total)}`}{/if}
				</p>
			</div>
			{#if strip || block.next}
				<!-- As wide as NEXT and its chips, not as wide as the band may grow:
				     the moment card's top-centre room is what slot 1 leaves (D12). -->
				<div class="flex w-88 min-w-0 shrink flex-col gap-2">
					{#if strip}<div class="h-10">{@render strip()}</div>{/if}
					{#if block.next}
						<!-- A name and an absolute target, never a delta (#1531, D16). -->
						<p class="{WORDS} flex items-center gap-2 whitespace-nowrap">
							<span class="ride-label">Next</span>
							<span class="min-w-0 truncate">
								{block.next.label}{#if block.next.watts > 0}
									· <span class="num text-neon">{block.next.watts} W</span>{/if}
								· <span class="num">{nextFor(block.next.seconds)}</span>
							</span>
							{#each [3, 2, 1] as n (n)}
								<span
									data-testid="count-chip"
									class="num grid size-7 shrink-0 place-items-center rounded border {counting ===
									n
										? 'border-neon text-ink'
										: 'border-neon/40 text-muted'}">{n}</span
								>
							{/each}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<h2 class="font-display truncate text-3xl leading-none font-bold">
			{title}
		</h2>
	{/if}
	{#if (drives && block) || block?.road || hint}
		<div class="flex items-center gap-4">
			{#if drives && block}
				<span data-testid="trainer-chip" class={CHIP}>{trainerChip(block)}</span
				>
			{/if}
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
