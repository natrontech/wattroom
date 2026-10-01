<script lang="ts">
	import type { Climb } from '$lib/road/climbs';
	import { profilePath } from '$lib/road/draw';
	import type { Road } from '$lib/road/road';

	/** A road's heights by distance, its classed climbs shaded and listed. */
	let { road, climbs }: { road: Road; climbs: Climb[] } = $props();

	const W = 600;
	const H = 140;
	const profile = $derived(profilePath(road.heights, W, H));
	const classed = $derived(climbs.filter((c) => c.cls));
</script>

<figure>
	<svg
		viewBox="0 0 {W} {H}"
		width="100%"
		preserveAspectRatio="none"
		class="text-ink h-28"
		role="img"
		aria-label="The road's heights by distance, its climbs shaded"
	>
		{#each classed as c (c.startM)}
			<rect
				x={(c.startM / road.length) * W}
				y="0"
				width={((c.topM - c.startM) / road.length) * W}
				height={H}
				class="fill-neon/15"
			/>
		{/each}
		<path
			d={profile}
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
	{#if classed.length > 0}
		<ul class="mt-2 flex flex-wrap gap-2" aria-label="Climbs">
			{#each classed as c (c.startM)}
				<li class="border-neon/40 rounded border px-2 text-xs">
					<span class="font-display font-bold">{c.cls}</span>
					<span class="text-muted num"
						>{((c.topM - c.startM) / 1000).toFixed(1)} km · {Math.round(
							c.gainM,
						)} m, top at {(c.topM / 1000).toFixed(1)} km</span
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted mt-2 text-xs">No classed climbs on this road.</p>
	{/if}
</figure>
