<script lang="ts">
	/**
	 * Onto one of your own roads, before a free ride starts (#3027): the
	 * road becomes the free ride's grade, and its metres its record. Behind
	 * the roads dev gate (roads.ts), like gears.
	 */
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import type { FreeRide } from '$lib/ride/free-ride.svelte';
	import { loadRoad, myRoutes, type RouteSummary } from '$lib/ride/roads';

	let { free }: { free: FreeRide } = $props();

	let open = $state(false);
	let routes = $state<RouteSummary[] | null>(null);
	let error = $state<string | null>(null);
	let loading = $state<string | null>(null);

	const km = (m: number) => (m / 1000).toFixed(1);

	async function show() {
		open = true;
		error = null;
		routes = null;
		const result = await myRoutes();
		if (result.ok) routes = result.routes;
		else error = result.error;
	}

	async function pick(id: string) {
		loading = id;
		error = null;
		const result = await loadRoad(id);
		loading = null;
		if (!result.ok) {
			error = result.error;
			return;
		}
		free.ride(result.route);
		open = false;
	}
</script>

{#if free.road}
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
		<span class="eyebrow">road</span>
		<span class="min-w-0 truncate font-semibold">{free.road.name}</span>
		<span class="text-muted num"
			>{km(free.road.m)} of {km(free.road.length)} km</span
		>
		{#if !free.recording}
			<button
				onclick={() => free.leaveRoad()}
				class="btn btn-ghost btn-xs ml-auto">Leave the road</button
			>
		{/if}
	</div>
{:else if !free.recording}
	{#if !open}
		<button onclick={show} class="btn btn-secondary">Ride a road</button>
	{:else if error}
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button onclick={show} class="btn-link text-xs">Try again</button>
			{/snippet}
		</Banner>
	{:else if routes === null}
		<Skeleton class="h-16" rows={2} />
	{:else if routes.length === 0}
		<p class="text-muted text-sm">
			Your routes ride here. Import a <code>.gpx</code> or
			<code>.tcx</code> under
			<a href="/workouts/import" class="underline">Import a workout</a>, and
			pick it here.
		</p>
	{:else}
		<ul class="border-frame divide-y border-y" aria-label="your routes">
			{#each routes as route (route.id)}
				<li class="flex flex-wrap items-center gap-3 py-2">
					<span class="min-w-0 flex-1 truncate text-sm">{route.name}</span>
					<span class="text-muted num text-xs"
						>{km(route.lengthM)} km · {route.gainM} m</span
					>
					<button
						onclick={() => void pick(route.id)}
						disabled={loading !== null}
						class="btn btn-secondary btn-xs"
						>{loading === route.id ? 'Loading…' : 'Ride it'}</button
					>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
