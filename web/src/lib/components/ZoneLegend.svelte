<script lang="ts">
	import { formatClock } from '$lib/format';
	import { ZONE_BG, ZONE_NAMES } from './zones';

	/**
	 * The zones something touches, named and timed — `seconds` indexed by zone
	 * (0 unused), the shape ZoneBar takes. Without it the zone colours are a
	 * code nothing on the page breaks (#1525).
	 */
	let {
		seconds,
		names = true,
	}: {
		seconds: number[];
		/** Off on a card, where "Z4 12:00" fits on one line and the name does not. */
		names?: boolean;
	} = $props();
</script>

<ul class="flex flex-wrap gap-x-4 gap-y-1.5">
	{#each seconds as zsec, zone (zone)}
		{#if zsec > 0}
			<li class="flex items-center gap-1.5 text-xs" title={ZONE_NAMES[zone]}>
				<span class="h-2 w-2 shrink-0 rounded-full {ZONE_BG[zone]}"></span>
				<span class="text-muted"
					>Z{zone}{names ? ` ${ZONE_NAMES[zone]}` : ''}</span
				>
				<span class="font-mono tabular-nums">{formatClock(zsec)}</span>
			</li>
		{/if}
	{/each}
</ul>
