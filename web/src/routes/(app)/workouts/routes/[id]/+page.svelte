<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import ClimbTable from '$lib/components/ClimbTable.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RouteAttempts from '$lib/components/RouteAttempts.svelte';
	import RouteProfile from '$lib/components/RouteProfile.svelte';
	import RouteShape from '$lib/components/RouteShape.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { confirm } from '$lib/confirm.svelte';
	import { device, isSpectator } from '$lib/device.svelte';
	import { routeNameLine, routePrivacyLine } from '$lib/privacy-copy';
	import { carryOnOf, roadsEnabled } from '$lib/ride/roads';
	import type { Attempt, ClimbBest } from '$lib/road/attempts';
	import { classedOf } from '$lib/road/climbs';
	import { isLoop } from '$lib/road/line';
	import {
		roadOf,
		shapeLine,
		statRow,
		type StoredRoute,
	} from '$lib/road/stored';
	import { toasts } from '$lib/toast.svelte';
	import RideHow from './RideHow.svelte';

	/**
	 * One route, as its owner sees it (#3061, #3680): the road on the left —
	 * the map only they may open, the profile, its climbs and their rides of
	 * it — and how to ride it on the right. Delete asks first — stored plans
	 * pay for it (errors.md) — and How shows only where this screen may ride a
	 * road (ux.md: a control it cannot use is not drawn).
	 */
	const id = $derived(page.params.id ?? '');

	let route = $state<StoredRoute | null>(null);
	let error = $state<string | null>(null);
	// Gone or someone else's: an empty state that says so, not an error.
	let missing = $state(false);
	let shape = $state<{ x: number[]; z: number[] } | null>(null);
	let shapeNote = $state<string | null>(null);

	type Attempts = { attempts: Attempt[]; climbBests: ClimbBest[] };
	let attempts = $state<Attempts | null>(null);
	let attemptsError = $state<string | null>(null);

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

	// Read once: Your rides, the climbs' bests and where to carry on all use it.
	async function loadAttempts(which: string) {
		attemptsError = null;
		const res = await api<Attempts>(`/api/routes/${which}/attempts`);
		if (res.ok) attempts = res.data;
		else attemptsError = res.error.message;
	}

	$effect(() => {
		const which = id;
		route = null;
		error = null;
		missing = false;
		shape = null;
		shapeNote = null;
		attempts = null;
		if (which) void load(which).then(() => loadAttempts(which));
	});

	const road = $derived(route ? roadOf(route) : null);
	const loop = $derived(
		route?.loop ?? (shape ? isLoop({ ...shape, e: [] }) : undefined),
	);
	const carry = $derived(
		attempts && road ? carryOnOf(attempts.attempts, road.length) : null,
	);
	const ridable = $derived(roadsEnabled());
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
			<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
				<Skeleton class="h-[220px] sm:h-[280px]" />
				<Skeleton class="h-40" />
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
		<p class="font-display text-muted mt-1 text-sm tabular-nums">
			<!-- Numbers in ink, their units muted (v3-roads). -->
			{#each statRow(route, loop) as part, i (part)}
				{@const n = part.match(/^([\d.]+)(.*)$/)}{i ? ' · ' : ''}<span
					class="whitespace-nowrap"
					>{#if n}<span class="text-ink">{n[1]}</span
						>{n[2]}{:else}{part}{/if}</span
				>{/each}
		</p>

		<!-- On a phone How comes first, its primary at the top; then the
		     profile, the shape, the climbs and the rides (TARGETS route 14). -->
		<div
			class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
		>
			{#if ridable && road}
				<aside
					class="lg:col-start-2 lg:row-start-1"
					aria-label="how to ride it"
				>
					<RideHow
						id={route.id}
						length={road.length}
						climbs={route.climbs}
						{carry}
						spectator={isSpectator(device)}
					/>
				</aside>
			{/if}
			<div class="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
				<div class="order-2 lg:order-1">
					{#if shape || shapeNote}
						<RouteShape
							x={shape?.x}
							z={shape?.z}
							climbs={route.climbs}
							length={road?.length}
							note={shapeNote ?? undefined}
						/>
					{:else}
						<Skeleton class="h-[220px] sm:h-[280px]" />
					{/if}
				</div>
				{#if road}
					<div class="order-1 lg:order-2">
						<RouteProfile {road} climbs={route.climbs} facts={false} />
					</div>
				{/if}
				{#if classedOf(route.climbs).length > 0}
					<div class="panel order-3">
						<ClimbTable
							climbs={route.climbs}
							bests={attempts?.climbBests ?? (attemptsError ? [] : null)}
						/>
					</div>
				{/if}
				<div class="panel order-4">
					<RouteAttempts
						data={attempts}
						error={attemptsError}
						onretry={() => void loadAttempts(route?.id ?? id)}
					/>
				</div>
			</div>
		</div>

		<div class="border-frame mt-8 grid gap-6 border-t pt-6">
			<form
				class="max-w-[30rem]"
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
			<p class="text-muted max-w-prose text-xs">{routePrivacyLine}</p>
			<div>
				<button onclick={() => void remove()} class="btn btn-danger"
					>Delete the route</button
				>
			</div>
		</div>
	{/if}
</main>
