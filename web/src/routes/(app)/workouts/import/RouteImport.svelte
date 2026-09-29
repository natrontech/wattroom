<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import { account } from '$lib/account.svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { roadsEnabled } from '$lib/ride/roads';
	import Banner from '$lib/components/Banner.svelte';
	import RoutePreview from '$lib/components/RoutePreview.svelte';
	import { device, isSpectator } from '$lib/device.svelte';
	import { packRoad } from '$lib/road/road';
	import { toasts } from '$lib/toast.svelte';
	import { base64Of, importRoute, type RouteChoice } from '$lib/workout/import';

	/**
	 * A route file on the import page (#3057): what the rider must choose
	 * first — which track, or a flat road — then the preview, then Save
	 * through POST /api/routes. Riding it and planning it wait for route
	 * rides, and say so rather than failing on a tap (errors.md).
	 */
	let { source, onanother }: { source: string; onanother: () => void } =
		$props();

	let choice = $state<RouteChoice>({});
	const outcome = $derived(importRoute(source, choice));
	const imported = $derived(outcome.ok ? outcome.imported : null);

	let rename = $state('');
	let saving = $state(false);
	// A refused save keeps the preview and offers the same save again; a
	// rename refused after the route was stored is said beside it, since
	// saving again would store a second copy.
	let saveError = $state<string | null>(null);
	let saved = $state<{
		id: string;
		name: string;
		renameError: string | null;
	} | null>(null);

	// A phone watching from the sofa has no trainer to ride it on.
	const spectator = $derived(isSpectator(device));

	async function save(): Promise<string | null> {
		if (!imported || saving) return null;
		const { route, src, eleSource } = imported;
		saving = true;
		saveError = null;
		const created = await api<{ id: string }>('/api/routes', {
			method: 'POST',
			json: {
				src,
				eleSource,
				road: base64Of(packRoad(route.road)),
				shape: route.shape,
				climbs: route.climbs,
			},
		});
		if (!created.ok) {
			saving = false;
			saveError = created.error.message;
			return null;
		}
		const name = rename.trim();
		let renameError: string | null = null;
		if (name && name !== route.name) {
			const renamed = await api(`/api/routes/${created.data.id}`, {
				method: 'PATCH',
				json: { name },
			});
			if (!renamed.ok) renameError = renamed.error.message;
		}
		saving = false;
		saved = {
			id: created.data.id,
			name: renameError ? route.name : name || route.name,
			renameError,
		};
		toasts.push(`Saved “${saved.name}” to your routes.`);
		return saved.id;
	}

	/** Ride it now (#3027): saved first, as a ride on a road rides a route. */
	async function rideNow() {
		const id = saved?.id ?? (await save());
		if (id) await goto(`/ride?road=${encodeURIComponent(id)}`);
	}
</script>

{#if !outcome.ok && 'tracks' in outcome}
	<div class="mt-4">
		<p class="text-sm">
			This file carries {outcome.tracks.length} tracks. Which one is the route?
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			{#each outcome.tracks as label, track (label)}
				<button
					onclick={() => (choice = { ...choice, track })}
					class="btn btn-secondary btn-lg num">{label}</button
				>
			{/each}
		</div>
	</div>
{:else if !outcome.ok && 'noHeights' in outcome}
	<div class="mt-3">
		<Banner tone="warn">
			This file carries no heights, so the road it makes is flat: no climbs, and
			the trainer holds one grade the whole way.
			{#snippet action()}
				<button
					onclick={() => (choice = { ...choice, flat: true })}
					class="btn btn-secondary btn-xs">Ride it flat</button
				>
			{/snippet}
		</Banner>
	</div>
{:else if !outcome.ok}
	<div class="mt-3">
		<Banner tone="error">{outcome.error}</Banner>
	</div>
{:else if saved}
	<div class="mt-4 space-y-3">
		<Banner tone="ok">
			“{saved.name}” is on your routes. A shelf for them under Workouts is
			coming; riding one arrives with route rides.
		</Banner>
		{#if saved.renameError}
			<Banner tone="warn"
				>Your own name for it did not stick: {saved.renameError}</Banner
			>
		{/if}
		<button onclick={onanother} class="btn btn-secondary btn-lg"
			>Import another file</button
		>
	</div>
{:else if imported}
	<div class="mt-4">
		<RoutePreview
			{imported}
			ftp={account.me?.ftpWatts || null}
			riderKg={account.me?.weightKg || null}
			bind:rename
		/>
	</div>

	{#if saveError}
		<!-- Atop the form it failed to submit (errors.md). -->
		<div class="mt-5">
			<Banner tone="error">
				{saveError}
				{#snippet action()}
					<button
						onclick={() => void save()}
						disabled={saving}
						class="btn-link text-xs">Try again</button
					>
				{/snippet}
			</Banner>
		</div>
	{/if}
	<div class="mt-5 flex flex-wrap items-center gap-3">
		<button
			onclick={() => void save()}
			disabled={saving}
			class="btn btn-primary btn-lg">Save to my routes</button
		>
		{#if !spectator}
			<!-- Behind the roads dev gate (#3027); a disabled control says why
			     (ux.md: never a press that fails). -->
			<button
				onclick={() => void rideNow()}
				disabled={saving || !roadsEnabled()}
				title={roadsEnabled()
					? undefined
					: 'Riding a road opens once the trainer numbers are final.'}
				class="btn btn-ghost btn-lg">Ride it now</button
			>
		{/if}
		<button disabled class="btn btn-ghost btn-lg">Plan it for a crew</button>
		{#if imported.src === 'stravagpx'}
			<span
				class="border-frame text-muted inline-flex items-center gap-1 rounded border px-2 text-xs"
			>
				<Lock size={12} /> Only you can ride this one
			</span>
		{/if}
	</div>
	<p class="text-muted mt-2 text-xs">
		{#if imported.src === 'stravagpx'}
			Files from Strava ride with you alone, never in a crew's plan.
			{#if !roadsEnabled()}Riding it arrives with route rides.{/if}
		{:else if roadsEnabled()}
			Planning it for a crew arrives with route rides.
		{:else}
			Riding it and planning it for a crew arrive with route rides.
		{/if}
	</p>
{/if}
