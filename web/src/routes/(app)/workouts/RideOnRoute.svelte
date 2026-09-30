<script lang="ts">
	/**
	 * Any workout, ridden on one of your own roads (#3594): pick the road,
	 * then where on it to start — Terrain Match's proposal (#3099) or km 0,
	 * one tap apart. Blocks still end by the clock; the road is scenery the
	 * dot rides at your own watts.
	 */
	import Banner from '$lib/components/Banner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { formatKm as km } from '$lib/format';
	import { loadRoad, myRoutes, type RouteSummary } from '$lib/ride/roads';
	import { matchTerrain } from '$lib/road/match';
	import type { Workout } from '$lib/workout/types';

	let {
		id,
		workout,
		onclose,
	}: { id: string; workout: Workout; onclose: () => void } = $props();

	let routes = $state<RouteSummary[] | null>(null);
	let error = $state<string | null>(null);
	let loading = $state<string | null>(null);
	let picked = $state<{
		id: string;
		name: string;
		bestM: number | null;
	} | null>(null);

	const href = (routeId: string, fromM: number) =>
		`/ride?w=${encodeURIComponent(id)}&road=${encodeURIComponent(routeId)}&from=${Math.round(fromM)}`;

	async function load() {
		error = null;
		const result = await myRoutes();
		if (result.ok) routes = result.routes;
		else error = result.error;
	}
	void load();

	async function pick(routeId: string) {
		loading = routeId;
		error = null;
		const result = await loadRoad(routeId);
		loading = null;
		if (!result.ok) {
			error = result.error;
			return;
		}
		// ponytail: a reversed start needs the road ridden backwards, which
		// onRoute cannot yet say — offer the best forward start or km 0.
		const { best } = matchTerrain(result.route.road, workout);
		picked = {
			id: routeId,
			name: result.route.name,
			bestM: !best.reverse && best.startM > 0 ? best.startM : null,
		};
	}
</script>

<Modal label="Ride it on a route" {onclose}>
	<h2 class="font-display text-lg font-bold">{workout.name} on a route</h2>
	<p class="text-muted mt-1 text-sm">
		Blocks end by the clock, as written. The road rolls by at your watts.
	</p>
	<div class="mt-4">
		{#if error}
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load()} class="btn-link text-xs"
						>Try again</button
					>
				{/snippet}
			</Banner>
		{:else if picked}
			<p class="text-sm">
				<span class="font-semibold">{picked.name}</span> — where to start?
			</p>
			<div class="mt-3 flex flex-wrap gap-2">
				{#if picked.bestM !== null}
					<a href={href(picked.id, picked.bestM)} class="btn btn-primary"
						>From km {km(picked.bestM)} · best match</a
					>
				{/if}
				<a
					href={href(picked.id, 0)}
					class="btn {picked.bestM === null ? 'btn-primary' : 'btn-secondary'}"
					>From km 0</a
				>
				<button onclick={() => (picked = null)} class="btn btn-ghost"
					>Another route</button
				>
			</div>
		{:else if routes === null}
			<Skeleton class="h-16" rows={2} />
		{:else if routes.length === 0}
			<p class="text-muted text-sm">
				Your routes ride here. Import a <code>.gpx</code> or
				<code>.tcx</code> under
				<a href="/workouts/import" class="underline">Import a workout</a>.
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
							>{loading === route.id ? 'Loading…' : 'Pick'}</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Modal>
