<script lang="ts">
	import RouteIcon from '@lucide/svelte/icons/route';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RouteRow from '$lib/components/RouteRow.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { confirm } from '$lib/confirm.svelte';
	import type { MenuEntry } from '$lib/context-menu.svelte';
	import { device, isSpectator } from '$lib/device.svelte';
	import { roadsEnabled } from '$lib/ride/roads';
	import type { StoredRoute } from '$lib/road/stored';
	import { toasts } from '$lib/toast.svelte';

	/**
	 * The rider's routes (#3061), under their workouts: a route is ridden the
	 * way a workout is, so it lives on the same page. Each is the one route
	 * row (#3683): the card opens its page, Ride rides it — from where they
	 * left off when there is somewhere to carry on.
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

	const rides = $derived(roadsEnabled() && !isSpectator(device));
	const rideHref = (r: StoredRoute) =>
		`/ride?road=${encodeURIComponent(r.id)}${r.carryOnM !== undefined ? `&from=${Math.floor(r.carryOnM)}` : ''}`;

	async function remove(r: StoredRoute) {
		const ok = await confirm({
			title: `Delete “${r.name}”?`,
			body: 'Plans that carry it lose their road. Your rides keep theirs.',
			action: 'Delete the route',
		});
		if (!ok) return;
		const res = await api(`/api/routes/${r.id}`, { method: 'DELETE' });
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		void load();
	}

	const menu = (r: StoredRoute) => (): MenuEntry[] => [
		...(rides
			? [{ label: 'Ride it', onSelect: () => void goto(rideHref(r)) }]
			: []),
		{ label: 'Open', onSelect: () => void goto(`/workouts/routes/${r.id}`) },
		'separator',
		{ label: 'Delete the route', danger: true, onSelect: () => void remove(r) },
	];
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
		<div class="mt-2 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
			<Skeleton class="h-24" rows={1} />
		</div>
	{:else if routes.length === 0}
		<div class="mt-2">
			<EmptyState>
				{#snippet icon()}<RouteIcon size={20} class="text-muted" />{/snippet}
				Your roads ride here — import a GPX, TCX or FIT.
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
				<li class="min-w-0">
					<RouteRow {route} card menu={menu(route)}>
						{#snippet action()}
							{#if rides}
								<a href={rideHref(route)} class="btn btn-primary btn-xs"
									>{route.carryOnM !== undefined ? 'Carry on' : 'Ride'}</a
								>
							{/if}
						{/snippet}
					</RouteRow>
				</li>
			{/each}
		</ul>
	{/if}
</section>
