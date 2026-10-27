<script lang="ts">
	/**
	 * WattRoom's own roads (#4248), above a rider's imported ones wherever a
	 * road is picked: every rider has these, so no road list starts empty.
	 * Each is the shared route row, measured off the road it builds, with what
	 * is along it in the ridden line's place; the caller gives it its Ride.
	 */
	import type { Snippet } from 'svelte';
	import RouteRow from '$lib/components/RouteRow.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import {
		HOME_ROADS,
		homeRoadsMatching,
		homeRow,
		type HomeRoad,
	} from '$lib/ride/home-roads';
	import type { StoredRoute } from '$lib/road/stored';

	let {
		ride,
		card = false,
		query = '',
		href,
	}: {
		/** The row's Ride, for the caller to give. */
		ride: Snippet<[HomeRoad]>;
		/** Workouts' shelf: route cards, two or three across. */
		card?: boolean;
		/** The shelf's search: a road shows while its name or line matches. */
		query?: string;
		/** Where a road's name goes; null keeps it plain, as the picker does. */
		href?: (road: HomeRoad) => string | null;
	} = $props();

	let rows = $state<StoredRoute[] | null>(null);
	void Promise.all(HOME_ROADS.map(homeRow)).then((r) => (rows = r));

	const shown = $derived(homeRoadsMatching(query));
</script>

{#if shown.length > 0}
	<ul
		aria-label="WattRoom roads"
		data-testid="wattroom-roads"
		class="grid {card ? 'gap-3 md:grid-cols-2 2xl:grid-cols-3' : 'gap-2'}"
	>
		{#each shown as road (road.id)}
			{@const row = rows?.find((r) => r.id === road.id)}
			<li class="min-w-0">
				{#if row}
					<RouteRow
						route={row}
						{card}
						note={road.story}
						href={href ? href(road) : null}
					>
						{#snippet action()}{@render ride(road)}{/snippet}
					</RouteRow>
				{:else}
					<Skeleton class={card ? 'h-24' : 'h-16'} rows={1} />
				{/if}
			</li>
		{/each}
	</ul>
{/if}
