<script lang="ts">
	/**
	 * WattRoom's own roads (#4248), above a rider's imported ones wherever a
	 * road is picked: every rider has these, so no road list starts empty.
	 * Each row says how long, how much it climbs and what is along it; the
	 * caller gives the row its Ride.
	 */
	import type { Snippet } from 'svelte';
	import { HOME_ROADS, type HomeRoad } from '$lib/ride/home-roads';

	let {
		action,
		grid = false,
	}: {
		action: Snippet<[HomeRoad]>;
		/** Workouts' shelf lays its rows out as cards, two or three across. */
		grid?: boolean;
	} = $props();
</script>

<ul
	aria-label="WattRoom roads"
	data-testid="wattroom-roads"
	class="grid gap-2 {grid ? 'gap-3 md:grid-cols-2 2xl:grid-cols-3' : ''}"
>
	{#each HOME_ROADS as road (road.id)}
		<li
			class="border-frame bg-surface-raised flex min-w-0 items-center gap-3 rounded border px-3 py-2"
		>
			<div class="min-w-0 flex-1">
				<p class="font-display text-base font-bold">{road.name}</p>
				<p class="num text-muted text-sm">
					{road.km} km · {road.gainM} m up
				</p>
				<p class="text-muted text-xs">{road.story}</p>
			</div>
			{@render action(road)}
		</li>
	{/each}
</ul>
