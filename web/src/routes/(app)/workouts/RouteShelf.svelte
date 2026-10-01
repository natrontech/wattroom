<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import RouteIcon from '@lucide/svelte/icons/route';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import type { StoredRoute } from '$lib/road/stored';

	/**
	 * The rider's routes (#3061), under their workouts: a route is ridden the
	 * way a workout is, so it lives on the same page. Each opens its own page;
	 * the importer is the one way in.
	 */
	let routes = $state<StoredRoute[] | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		error = null;
		const res = await api<{ routes: StoredRoute[] }>('/api/routes');
		if (res.ok) routes = res.data.routes;
		else error = res.error.message;
	}
	void load();
</script>

<section class="mt-8">
	<div class="flex flex-wrap items-baseline gap-3">
		<h2 class="eyebrow">your routes</h2>
		{#if routes && routes.length > 0}
			<a href="/workouts/import" class="btn btn-ghost btn-xs">Import a route</a>
		{/if}
	</div>
	{#if error}
		<!-- A shelf that could not be read is not an empty shelf (errors.md). -->
		<div class="mt-2">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if routes === null}
		<div class="mt-2 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
			<Skeleton class="h-20" rows={1} />
		</div>
	{:else if routes.length === 0}
		<div class="mt-2">
			<EmptyState>
				{#snippet icon()}<RouteIcon size={20} class="text-muted" />{/snippet}
				Ride your own roads. Drop a GPX from Komoot or your Garmin and your crew rides
				it with you.
				{#snippet cta()}
					<a href="/workouts/import" class="btn btn-primary btn-xs"
						>Import a route</a
					>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<ul class="mt-2 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
			{#each routes as route (route.id)}
				{@const classes = route.climbs.flatMap((c) => (c.cls ? [c.cls] : []))}
				<li>
					<a
						href="/workouts/routes/{route.id}"
						class="panel panel-lg hover:border-neon/40 block"
					>
						<div class="flex items-baseline gap-2">
							<p
								class="font-display min-w-0 flex-1 truncate text-base font-bold"
							>
								{route.name}
							</p>
							{#if route.ownerOnly}
								<span
									class="text-muted inline-flex shrink-0 items-center gap-1 text-xs"
									><Lock size={12} /> Only you</span
								>
							{/if}
						</div>
						{#if route.name !== route.generatedName}
							<p class="text-muted num truncate text-xs">
								{route.generatedName}
							</p>
						{/if}
						<p class="text-muted mt-1 text-xs">
							{classes.length > 0
								? `Climbs: ${classes.join(' · ')}`
								: 'No classed climbs'}
						</p>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>
