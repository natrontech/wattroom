<script lang="ts">
	import { formatClock } from '$lib/format';
	import { ZONE_BG, ZONE_NAMES } from './zones';

	/** Stacked time-in-zone bar; `seconds` is indexed by zone (0 unused). */
	let {
		seconds,
		legend = false,
	}: {
		seconds: number[];
		legend?: boolean;
	} = $props();

	const total = $derived(seconds.reduce((a, b) => a + b, 0));
</script>

{#if total > 0}
	<div class="flex h-3 gap-px overflow-hidden rounded-full">
		{#each seconds as zsec, zone (zone)}
			{#if zsec > 0}
				<div
					class={ZONE_BG[zone]}
					style="width: {(zsec / total) * 100}%"
					title="{ZONE_NAMES[zone]}: {formatClock(zsec)}"
				></div>
			{/if}
		{/each}
	</div>
	{#if legend}
		<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
			{#each seconds as zsec, zone (zone)}
				{#if zsec > 0}
					<li class="flex items-center gap-1.5 text-xs">
						<span class="h-2 w-2 shrink-0 rounded-full {ZONE_BG[zone]}"></span>
						<span class="text-muted">Z{zone} {ZONE_NAMES[zone]}</span>
						<span class="font-mono tabular-nums">{formatClock(zsec)}</span>
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
{/if}
