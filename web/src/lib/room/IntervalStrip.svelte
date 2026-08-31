<script lang="ts">
	import { formatClock, type Block } from '$lib/room/mockcompat';

	let {
		block,
		bias,
		onBias,
		big = false,
		cadence = 0,
	}: {
		block: Block | null;
		bias: number;
		/** Omitted in TV mode — nothing there is clickable from across the room. */
		onBias?: (step: number) => void;
		big?: boolean;
		/** Your live rpm — colours the cadence band in or out (#66). */
		cadence?: number;
	} = $props();

	const bandText = $derived.by(() => {
		if (!block) return null;
		const { cadenceLow: low, cadenceHigh: high } = block;
		if (low !== undefined && high !== undefined) return `${low}–${high} rpm`;
		if (high !== undefined) return `under ${high} rpm`;
		if (low !== undefined) return `over ${low} rpm`;
		return null;
	});
	const inBand = $derived(
		!!block &&
			cadence > 0 &&
			(block.cadenceLow === undefined || cadence >= block.cadenceLow) &&
			(block.cadenceHigh === undefined || cadence <= block.cadenceHigh),
	);
</script>

<!--
	The number a rider actually watches during a structured workout is not elapsed —
	it is how long is left in THIS block, and what lands next. Zwift and TrainerRoad
	both put that front and centre; the first version of this room had neither.
-->
{#if block}
	<div
		class="bg-surface-raised ring-ink/10 flex items-center gap-[3%] rounded-lg ring-1 {big
			? 'px-[2vw] py-[1.6vh]'
			: 'px-5 py-3'}"
	>
		<div class="min-w-0">
			<p
				class="text-muted text-[10px] tracking-[0.2em] uppercase {big
					? 'text-[1.5vh]'
					: ''}"
			>
				block {block.index} of {block.count}
			</p>
			<p
				class="font-display truncate font-bold {big ? 'text-[3vh]' : 'text-lg'}"
			>
				{block.label}
			</p>
			{#if bandText}
				<!-- Cadence is the point of this block; colour answers "am I doing it". -->
				<p
					class="font-display font-semibold tabular-nums {big
						? 'text-[2.2vh]'
						: 'text-sm'} {inBand ? 'text-z4' : 'text-z5'}"
				>
					at {bandText}
				</p>
			{/if}
		</div>

		<div class="ml-auto text-right">
			<p
				class="font-display leading-none font-bold tabular-nums {big
					? 'text-[7vh]'
					: 'text-4xl'}"
			>
				{formatClock(block.secondsLeft)}
			</p>
			<p
				class="text-muted text-[10px] tracking-wider uppercase {big
					? 'text-[1.5vh]'
					: ''}"
			>
				left in block
			</p>
		</div>

		{#if block.next}
			<div class="border-ink/10 border-l pl-[3%] text-right">
				<p
					class="text-muted text-[10px] tracking-[0.2em] uppercase {big
						? 'text-[1.5vh]'
						: ''}"
				>
					next
				</p>
				<p
					class="font-display font-semibold tabular-nums {big
						? 'text-[2.4vh]'
						: 'text-base'}"
				>
					{block.next.label}
				</p>
				<p
					class="text-muted font-mono text-[11px] tabular-nums {big
						? 'text-[1.5vh]'
						: ''}"
				>
					{block.next.watts} W · {formatClock(block.next.seconds)}
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
					<div class="text-muted text-[9px] tracking-wider uppercase">bias</div>
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
