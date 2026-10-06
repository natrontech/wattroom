<script lang="ts">
	/**
	 * Onto one of your own roads, before a free ride starts (#3027): the
	 * road becomes the free ride's grade, and its metres its record. Behind
	 * the roads dev gate (roads.ts), like gears. Given `onpick` it only picks:
	 * /ride's Ride card opens it from “Change” and keeps the road itself
	 * (#3671), with where to start as its own chips.
	 */
	import { untrack } from 'svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import type { FreeRide } from '$lib/ride/free-ride.svelte';
	import { formatKm as km } from '$lib/format';
	import { carriesOn } from '$lib/ride/road-end';
	import {
		carryOnFrom,
		loadRoad,
		myRoutes,
		type RideableRoute,
		type RouteSummary,
	} from '$lib/ride/roads';

	let {
		free,
		onpick,
	}: {
		free?: FreeRide;
		onpick?: (route: RideableRoute) => void;
	} = $props();

	let open = $state(false);
	let routes = $state<RouteSummary[] | null>(null);
	let error = $state<string | null>(null);
	let loading = $state<string | null>(null);
	// A road the rider stopped short on last time (#3205): where to start.
	let choosing = $state.raw<{ route: RideableRoute; carry: number } | null>(
		null,
	);

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
		if (!result.ok) {
			loading = null;
			error = result.error;
			return;
		}
		if (onpick) {
			loading = null;
			onpick(result.route);
			return;
		}
		const carry = await carryOnFrom(result.route.id, result.route.road.length);
		loading = null;
		if (carry !== null) choosing = { route: result.route, carry };
		else onto(result.route, 0);
	}

	// Opened from “Change”: the list is what the rider asked for.
	if (untrack(() => onpick)) void show();

	function onto(route: RideableRoute, from: number) {
		free?.ride(route, from);
		choosing = null;
		open = false;
	}
</script>

{#if free?.road}
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
		<span class="eyebrow">road</span>
		<span class="min-w-0 truncate font-semibold">{free.road.name}</span>
		<!-- How far along it is the bike computer's to say (#3628). -->
		{#if !free.recording}
			<button
				onclick={() => free.leaveRoad()}
				class="btn btn-ghost btn-xs ml-auto">Leave the road</button
			>
		{:else if carriesOn(free.road)}
			<span class="text-muted ml-auto text-xs"
				>Save it, and carry on from here next time.</span
			>
		{/if}
	</div>
{:else if !free?.recording}
	{#if choosing}
		{@const { route, carry } = choosing}
		<div class="flex flex-wrap items-center gap-3">
			<span class="min-w-0 flex-1 truncate text-sm font-semibold"
				>{route.name}</span
			>
			<button onclick={() => onto(route, carry)} class="btn btn-primary"
				>Carry on from km {km(carry)}</button
			>
			<button onclick={() => onto(route, 0)} class="btn btn-secondary"
				>From the start</button
			>
		</div>
	{:else if !open}
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
