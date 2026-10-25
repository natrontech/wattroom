<script lang="ts">
	import { formatClock } from '$lib/format';
	import type { Block } from '$lib/workout/block';
	import { blockBands, nextText, trainerChip } from '$lib/workout/block';
	import { TV_LABEL } from '$lib/session/computer-pages';
	import CountChips from '$lib/session/CountChips.svelte';

	let {
		block,
		bias,
		onBias,
		big = false,
		cadence = 0,
		hr = 0,
		elapsed = 0,
		total = 0,
		head,
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
		/** The workout clock, slot 1's "elapsed of total" on the TV (#3677). */
		elapsed?: number;
		total?: number;
		/** The TV's eyebrow and its way out, the panel's first row (#3677). */
		head?: import('svelte').Snippet;
	} = $props();

	const bands = $derived(blockBands(block, cadence, hr));
</script>

<!--
	The number a rider actually watches during a structured workout is not elapsed —
	it is how long is left in THIS block, and what lands next. Zwift and TrainerRoad
	both put that front and centre; the first version of the group ride had neither.
-->
{#if block && big}
	<!-- Slot 1 at three metres (#3677), v2-erg's work band stood up: the
	     eyebrow, time left over the block, its target, the clock and the
	     trainer chip, then NEXT as describeBlock says it (D16) and its 3-2-1
	     chips. Time left takes the height its panel has, up to just under the
	     watts (ride-tv 9): sized from its box, which shrinks before any word. -->
	<div
		class="ride-panel @container flex max-h-full min-h-0 min-w-0 flex-col overflow-hidden px-[1.5vw] py-[1.5vh]"
	>
		{#if head}
			<div class="mb-[2vh]">{@render head()}</div>
		{/if}
		<p class={TV_LABEL}>left in block</p>
		<div
			class="[container-type:size] mt-[1vh] max-h-[25.5vh] min-h-[7.7vh] shrink grow {formatClock(
				block.secondsLeft,
			).length > 4
				? 'basis-[calc(min(30vh,24cqw)*0.85)]'
				: 'basis-[calc(min(30vh,30cqw)*0.85)]'}"
		>
			<p
				class="font-display leading-[0.85] font-bold whitespace-nowrap tabular-nums {formatClock(
					block.secondsLeft,
				).length > 4
					? 'text-[length:min(117.6cqh,28cqw)]'
					: 'text-[length:min(117.6cqh,35cqw)]'}"
			>
				{formatClock(block.secondsLeft)}
			</p>
		</div>
		<!-- v2-erg's lines under the clock: the block, its target, the clock. -->
		<p class="mt-[3vh] truncate text-[5vh] leading-none">
			Block <span class="num">{block.index} of {block.count}</span> · {block.label}
		</p>
		{#if block.band}
			<!-- Prescribed, so neon: watt is only measured live data. -->
			<p class="mt-[2vh] text-[5vh] leading-none">
				Target <span class="num text-neon font-bold">{block.watts} W</span>
				· <span class="num">{block.band.low}–{block.band.high}</span>
			</p>
		{/if}
		<p class="num text-muted mt-[2vh] text-[5vh] leading-none">
			{formatClock(elapsed)}{#if total > 0}{` of ${formatClock(total)}`}{/if}
		</p>
		<p class="mt-[2vh]">
			<span
				class="border-neon/40 inline-block rounded border px-[1vw] py-[0.6vh] text-[3.4vh] leading-none"
				>{trainerChip(block)}</span
			>
		</p>
		{#each bands as b (b.text)}
			<p
				class="font-display mt-[2vh] text-[5vh] leading-none font-semibold tabular-nums {b.inBand
					? 'text-ok'
					: 'text-warn'}"
			>
				at {b.text}
			</p>
		{/each}
		{#if block.next}
			<div
				class="border-ink/10 mt-[2vh] flex flex-wrap items-baseline gap-x-[1vw] gap-y-[1.5vh] border-t pt-[2vh] text-[6vh] leading-none"
			>
				<span class={TV_LABEL}>next</span>
				<span class="font-display min-w-0 truncate font-semibold"
					>{nextText(block.next)}</span
				>
				<CountChips
					secondsLeft={block.secondsLeft}
					size="size-[6vh] self-center text-[3.4vh]"
				/>
			</div>
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
					{nextText(block.next)}
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
