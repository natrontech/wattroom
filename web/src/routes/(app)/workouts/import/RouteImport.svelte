<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import { account } from '$lib/account.svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import RoutePreview from '$lib/components/RoutePreview.svelte';
	import { device, isSpectator } from '$lib/device.svelte';
	import { packRoad } from '$lib/road/road';
	import { toasts } from '$lib/toast.svelte';
	import { base64Of, importRoute, type RouteChoice } from '$lib/workout/import';

	/**
	 * A route file on the import page (#3057): what the rider must choose
	 * first — which track, or a flat road — then the preview, then Save
	 * through POST /api/routes, which leaves a way into the saved route.
	 */
	let {
		source,
		onanother,
	}: { source: string | Uint8Array; onanother: () => void } = $props();

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

	// A phone watching from the sofa has no trainer to ride it on, and a
	// screen that may not ride a road is not offered one (ux.md).
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
				loop: route.loop,
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
		return saved.id;
	}

	/** Ride it now (#3027): saved first, as a ride on a road rides a route. */
	async function rideNow() {
		const wasSaved = !!saved;
		const id = saved?.id ?? (await save());
		if (!id) return;
		// Leaving the page leaves the banner behind, so the save is said as
		// the ride opens; staying, the banner says it once.
		if (!wasSaved && saved)
			toasts.push(`Saved “${saved.name}” to your routes.`);
		await goto(`/ride?road=${encodeURIComponent(id)}`);
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
			“{saved.name}” is on your routes.
			{#snippet action()}
				<span class="flex shrink-0 gap-2">
					<a
						href="/workouts/routes/{encodeURIComponent(saved!.id)}"
						class="btn btn-secondary btn-xs">Open it</a
					>
					{#if !spectator}
						<a
							href="/ride?road={encodeURIComponent(saved!.id)}"
							class="btn btn-secondary btn-xs">Ride it</a
						>
					{/if}
				</span>
			{/snippet}
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
		>
			{#snippet actions()}
				{#if saveError}
					<!-- Atop the actions it failed to submit (errors.md). -->
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
				{/if}
				<!-- The actions stack full width, primary first. A crew plans a
				     road from its session picker, not from here. -->
				<div class="flex flex-col gap-3">
					<button
						onclick={() => void save()}
						disabled={saving}
						class="btn btn-primary btn-lg w-full">Save to my routes</button
					>
					{#if !spectator}
						<button
							onclick={() => void rideNow()}
							disabled={saving}
							class="btn btn-secondary btn-lg w-full">Ride it now</button
						>
					{/if}
					{#if imported.src === 'stravagpx'}
						<p class="text-muted flex items-start gap-1 text-xs">
							<Lock size={12} class="mt-px shrink-0" />
							Files from Strava ride with you alone, never in a crew's plan.
						</p>
					{/if}
				</div>
			{/snippet}
		</RoutePreview>
	</div>
{/if}
