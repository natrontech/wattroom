<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RouteProfile from '$lib/components/RouteProfile.svelte';
	import RouteShape from '$lib/components/RouteShape.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { confirm } from '$lib/confirm.svelte';
	import { routeNameLine, routePrivacyLine } from '$lib/privacy-copy';
	import { roadOf, shapeLine, type StoredRoute } from '$lib/road/stored';
	import { toasts } from '$lib/toast.svelte';

	/**
	 * One route, as its owner sees it (#3061): the map only they may open, the
	 * profile and its climbs, and what they can do with it. Delete asks first —
	 * stored plans pay for it (errors.md) — and Ride it waits for route rides.
	 */
	const id = $derived(page.params.id ?? '');

	let route = $state<StoredRoute | null>(null);
	let error = $state<string | null>(null);
	// Gone or someone else's: an empty state that says so, not an error.
	let missing = $state(false);
	let shape = $state<{ x: number[]; z: number[] } | null>(null);
	let shapeNote = $state<string | null>(null);

	let name = $state('');
	let renaming = $state(false);
	let renameError = $state<string | null>(null);

	async function load(which: string) {
		error = null;
		const res = await api<StoredRoute>(`/api/routes/${which}`);
		if (!res.ok) {
			missing = res.error.error === 'not_found';
			error = res.error.message;
			return;
		}
		route = res.data;
		name = res.data.name;
		if (!res.data.hasPlace) {
			shapeNote = res.data.hint ?? 'This route kept its heights, not its map.';
			return;
		}
		const place = await api<{ shape: string }>(`/api/routes/${which}/shape`);
		if (place.ok) shape = shapeLine(place.data.shape);
		else shapeNote = place.error.message;
	}

	$effect(() => {
		const which = id;
		route = null;
		error = null;
		missing = false;
		shape = null;
		shapeNote = null;
		if (which) void load(which);
	});

	const road = $derived(route ? roadOf(route) : null);
	const renamed = $derived(
		route !== null && name.trim() !== '' && name.trim() !== route.name,
	);

	async function rename() {
		if (!route || !renamed) return;
		renaming = true;
		renameError = null;
		const res = await api<{ name: string }>(`/api/routes/${route.id}`, {
			method: 'PATCH',
			json: { name: name.trim() },
		});
		renaming = false;
		if (!res.ok) {
			renameError = res.error.message;
			return;
		}
		route = { ...route, name: res.data.name };
		toasts.push(`Renamed to “${res.data.name}”.`);
	}

	async function remove() {
		if (!route) return;
		const gone = route;
		const ok = await confirm({
			title: `Delete “${gone.name}”?`,
			body: 'Plans that carry it lose their road. Your rides keep theirs.',
			action: 'Delete the route',
		});
		if (!ok) return;
		const res = await api(`/api/routes/${gone.id}`, { method: 'DELETE' });
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(`Deleted “${gone.name}”.`);
		await goto('/workouts');
	}
</script>

<svelte:head
	><title>{route ? `${route.name} · ` : ''}Routes · WattRoom</title
	></svelte:head
>

<main class="page">
	<a href="/workouts" class="text-muted hover:text-ink text-xs">← Workouts</a>

	{#if missing}
		<div class="mt-8">
			<EmptyState>
				<p class="text-ink text-sm">This route isn't here.</p>
				<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
					It was deleted, or it is not one of yours. Your own routes are all
					under Workouts.
				</p>
				{#snippet cta()}
					<a href="/workouts" class="btn btn-secondary">Open Workouts</a>
				{/snippet}
			</EmptyState>
		</div>
	{:else if error}
		<div class="mt-8">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load(id)} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if route === null}
		<div class="mt-4">
			<Skeleton class="h-7 w-64" />
			<Skeleton class="mt-2 h-3 w-44" />
			<div class="mt-6 grid gap-4 sm:grid-cols-[2fr_3fr]">
				<Skeleton class="h-40" />
				<Skeleton class="h-28" />
			</div>
		</div>
	{:else}
		<div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h1 class="page-title min-w-0 truncate">{route.name}</h1>
			{#if route.ownerOnly}
				<span
					class="border-frame text-muted inline-flex items-center gap-1 rounded border px-2 text-xs"
					><Lock size={12} /> Only you</span
				>
			{/if}
		</div>
		{#if route.name !== route.generatedName}
			<p class="text-muted num text-xs">{route.generatedName}</p>
		{/if}

		<div class="mt-4 grid gap-4 sm:grid-cols-[2fr_3fr]">
			{#if shape}
				<RouteShape x={shape.x} z={shape.z} />
			{:else}
				<p class="text-muted text-xs">{shapeNote ?? ''}</p>
			{/if}
			{#if road}
				<RouteProfile {road} climbs={route.climbs} />
			{/if}
		</div>

		<div class="mt-6 flex flex-wrap items-center gap-3">
			<button disabled class="btn btn-primary btn-lg">Ride it</button>
			<span class="text-muted text-xs">
				{route.ownerOnly
					? 'Files from Strava ride with you alone. Riding it arrives with route rides.'
					: 'Riding it arrives with route rides.'}
			</span>
		</div>

		<form
			class="mt-6"
			onsubmit={(event) => {
				event.preventDefault();
				void rename();
			}}
		>
			<label for="route-name" class="eyebrow">your name for it</label>
			<div class="mt-1 flex flex-wrap gap-2">
				<input
					id="route-name"
					bind:value={name}
					maxlength="80"
					class="input min-w-0 flex-1"
				/>
				<button disabled={!renamed || renaming} class="btn btn-secondary"
					>Rename</button
				>
			</div>
			{#if renameError}
				<!-- Field-level, under the field (errors.md). -->
				<p class="text-danger mt-1 text-xs" role="alert">{renameError}</p>
			{/if}
			<p class="text-muted mt-1 text-xs">
				{routeNameLine(route.generatedName)}
			</p>
		</form>

		<p class="text-muted mt-6 text-xs">{routePrivacyLine}</p>

		<div class="border-frame mt-6 border-t pt-4">
			<button onclick={() => void remove()} class="btn btn-danger"
				>Delete the route</button
			>
		</div>
	{/if}
</main>
