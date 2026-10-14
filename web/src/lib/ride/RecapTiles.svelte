<script lang="ts">
	import type { RecapTile } from '$lib/ride/recap-frame';

	// A finished ride's numbers (#3686), three by two: the closing card's and
	// the ride page's, in the same order (`recapTiles`).
	let { tiles }: { tiles: RecapTile[] } = $props();
</script>

<section
	aria-label="the ride in numbers"
	class="grid grid-cols-2 gap-2 sm:grid-cols-3"
>
	{#each tiles as tile (tile.label)}
		<div class="panel py-2" data-testid="recap-tile">
			<div class="eyebrow leading-none">{tile.label}</div>
			<div class="mt-1 flex items-baseline gap-1">
				<span class="font-display text-2xl leading-none font-bold tabular-nums"
					>{tile.value}</span
				>
				{#if tile.unit}
					<span class="text-muted text-xs">{tile.unit}</span>
				{/if}
			</div>
		</div>
	{/each}
</section>
