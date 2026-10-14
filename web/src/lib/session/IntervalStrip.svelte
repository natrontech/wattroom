<script lang="ts">
	import { formatClock } from '$lib/format';
	import type { Block } from '$lib/workout/block';
	import { blockBands, nextFor } from '$lib/workout/block';
	import { TV_LABEL } from '$lib/session/computer-pages';

	let {
		block,
		bias,
		onBias,
		big = false,
		cadence = 0,
		hr = 0,
	}: {
		block: Block | null;
		bias: number;
		/** Omitted in TV mode — nothing there is clickable from three metres away. */
		onBias?: (step: number) => void;
		big?: boolean;
		/** Your live rpm — colours the cadence band in or out (#66). */
		cadence?: number;
		/** Your live bpm — colours the HR band in or out (#67). */
		hr?: number;
	} = $props();

	const bands = $derived(blockBands(block, cadence, hr));
</script>

<!--
	The number a rider actually watches during a structured workout is not elapsed —
	it is how long is left in THIS block, and what lands next. Zwift and TrainerRoad
	both put that front and centre; the first version of the group ride had neither.
-->
{#if block && big}
	<!-- Slot 1 at three metres (#3677): one panel, stacked beside the
	     computer, as tall as it; NEXT is describeBlock's line (D16). -->
	<div
		class="ride-panel flex h-full flex-col justify-between gap-[1.5vh] px-[1.5vw] py-[1.5vh]"
	>
		<div class="min-w-0">
			<p class={TV_LABEL}>block {block.index} of {block.count}</p>
			<p
				class="font-display mt-[1vh] truncate text-[5vh] leading-none font-bold"
			>
				{block.label}
			</p>
			{#each bands as b (b.text)}
				<p
					class="font-display mt-[1vh] text-[3vh] font-semibold tabular-nums {b.inBand
						? 'text-ok'
						: 'text-warn'}"
				>
					at {b.text}
				</p>
			{/each}
		</div>
		<div>
			<p class="font-display text-[14vh] leading-[0.85] font-bold tabular-nums">
				{formatClock(block.secondsLeft)}
			</p>
			<p class="{TV_LABEL} mt-[1vh]">left in block</p>
		</div>
		{#if block.next}
			<p
				class="border-ink/10 flex items-baseline gap-[1vw] border-t pt-[1.5vh] text-[4vh] leading-none"
			>
				<span class={TV_LABEL}>next</span>
				<span class="font-display min-w-0 truncate font-semibold"
					>{block.next.label}{#if block.next.watts > 0}
						· <span class="num text-neon">{block.next.watts} W</span>{/if}
					· <span class="num">{nextFor(block.next.seconds)}</span></span
				>
			</p>
		{/if}
	</div>
{:else if block}
	<div
		class="bg-surface-raised ring-ink/10 flex items-center gap-[3%] rounded-lg px-5 py-3 ring-1"
	>
		<div class="min-w-0">
			<p class="eyebrow">
				block {block.index} of {block.count}
			</p>
			<p class="font-display truncate text-lg font-bold">
				{block.label}
			</p>
			{#each bands as b (b.text)}
				<!-- The band is the block's point; colour answers "am I doing it". -->
				<p
					class="font-display text-sm font-semibold tabular-nums {b.inBand
						? 'text-ok'
						: 'text-warn'}"
				>
					at {b.text}
				</p>
			{/each}
		</div>

		<div class="ml-auto text-right">
			<p class="font-display text-4xl leading-none font-bold tabular-nums">
				{formatClock(block.secondsLeft)}
			</p>
			<p class="eyebrow">left in block</p>
		</div>

		{#if block.next}
			<div class="border-ink/10 border-l pl-[3%] text-right">
				<p class="eyebrow">next</p>
				<p class="font-display text-base font-semibold tabular-nums">
					{block.next.label}
				</p>
				<p class="text-muted num text-[11px]">
					{#if block.next.watts > 0}{block.next.watts} W ·
					{/if}{nextFor(block.next.seconds)}
				</p>
			</div>
		{/if}

		{#if onBias}
			<!-- Intensity trim: the one control worth reaching for mid-interval. -->
			<div class="border-ink/10 flex items-center gap-1 border-l pl-4">
				<button
					onclick={() => onBias(-0.01)}
					class="border-muted/25 hover:border-muted/60 h-9 w-9 rounded border text-sm"
					aria-label="Lower intensity">−</button
				>
				<div class="w-14 text-center">
					<div class="font-display text-sm leading-none font-bold tabular-nums">
						{Math.round(bias * 100)}%
					</div>
					<div class="eyebrow">bias</div>
				</div>
				<button
					onclick={() => onBias(0.01)}
					class="border-muted/25 hover:border-muted/60 h-9 w-9 rounded border text-sm"
					aria-label="Raise intensity">+</button
				>
			</div>
		{/if}
	</div>
{/if}
