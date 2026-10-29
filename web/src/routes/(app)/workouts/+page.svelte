<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Play from '@lucide/svelte/icons/play';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import { homeRoad } from '$lib/ride/home-roads';
	import { account } from '$lib/account.svelte';
	import { type MenuEntry } from '$lib/context-menu.svelte';
	import RideOnRoute from './RideOnRoute.svelte';
	import RouteShelf from './RouteShelf.svelte';
	import RouteIcon from '@lucide/svelte/icons/route';
	import { device, isSpectator } from '$lib/device.svelte';
	import WorkoutCard from './WorkoutCard.svelte';
	import { durationSeconds } from '$lib/workout/engine';
	import { byFocus, focuses, library, type Focus } from '$lib/workout/library';
	import {
		customWorkouts,
		type CustomWorkout,
	} from '$lib/workout/custom.svelte';
	import type { Workout } from '$lib/workout/types';
	import { toasts } from '$lib/toast.svelte';
	import { RAMP_TAKES } from '$lib/workout/ramp';
	import {
		fetchProgression,
		suggestedFocuses,
		type Suggestion,
	} from '$lib/progression';

	// The same FTP the editor draws with (#1003), so one workout is not two
	// different pictures; 265 only covers the flicker before `me` lands.
	const previewFtp = $derived(account.me?.ftpWatts || 265);

	const custom = customWorkouts();
	let active = $state<Focus | 'All'>('All');

	// SPEC's "suggested for today" (#222): a badge with its one-clause why —
	// hidden through the cold start (the server withholds it), never a gate.
	let suggestion = $state<Suggestion | null>(null);
	void fetchProgression().then((r) => {
		if (r.ok) suggestion = r.data?.load?.suggestion ?? null;
	});
	const suggested = $derived(suggestedFocuses(suggestion));

	// Undo over confirm (errors.md): delete now, offer the way back. Shared by
	// the card's Delete and its menu.
	function removeCustom(entry: CustomWorkout) {
		const workout = $state.snapshot(entry.workout) as Workout;
		void custom.remove(entry.id).then((err) => {
			if (err) toasts.push(err, { tone: 'error' });
			else
				toasts.push(`Deleted “${workout.name}”.`, {
					// The undo re-creates it; a refusal has to be said, or the
					// workout is gone with the toast.
					undo: () =>
						void custom.save(workout).then((r) => {
							if (r.error) toasts.push(r.error, { tone: 'error' });
						}),
				});
		});
	}

	// A card's verbs, as a menu (#486) — the same buttons the card carries.
	const rideItem = (id: string, workout: Workout) => ({
		label: 'Ride',
		icon: Play,
		onSelect: () =>
			on ? (routeFor = { id, workout }) : void goto(`/ride?w=${id}`),
	});
	// Any workout on one of your roads (#3594) — not from a phone spectator,
	// who rides nothing.
	const onRoads = $derived(!isSpectator(device));
	let routeFor = $state<{ id: string; workout: Workout } | null>(null);
	// Picking a workout for one road, from its route page (#3681): each
	// card's Ride opens RideOnRoute already on that road.
	const on = $derived(onRoads ? page.url.searchParams.get('on') : null);
	let onName = $state<string | null>(null);
	$effect(() => {
		onName = null;
		const id = on;
		if (!id) return;
		// One of WattRoom's roads has no route row to read (#4257).
		const home = homeRoad(id);
		if (home) {
			onName = home.name;
			return;
		}
		// ponytail: a name that could not be read leaves "your road"; picking
		// a workout reads the road again and says why it failed.
		void api<{ name: string }>(`/api/routes/${encodeURIComponent(id)}`).then(
			(res) => {
				if (id === on) onName = res.ok ? res.data.name : null;
			},
		);
	});
	const routeItems = (id: string, workout: Workout): MenuEntry[] =>
		onRoads && !on
			? [
					{
						label: 'Ride it on a route',
						icon: RouteIcon,
						onSelect: () => (routeFor = { id, workout }),
					},
				]
			: [];
	const libraryMenu = (id: string, workout: Workout): MenuEntry[] => [
		rideItem(id, workout),
		...routeItems(id, workout),
		{
			label: 'Save a copy',
			icon: Copy,
			onSelect: () => void goto(`/workouts/edit?from=${id}`),
		},
	];
	const customMenu = (entry: CustomWorkout): MenuEntry[] => [
		rideItem(entry.id, entry.workout),
		...routeItems(entry.id, entry.workout),
		{
			label: 'Edit',
			icon: Pencil,
			onSelect: () => void goto(`/workouts/edit?w=${entry.id}`),
		},
		'separator',
		{
			label: 'Delete',
			icon: Trash2,
			onSelect: () => removeCustom(entry),
			danger: true,
		},
	];
	// Find it by name or by what it trains — the picker had this and the
	// page did not (#1713): your own shelf is the one list with no ceiling.
	let query = $state('');
	const matches = (name: string, ...more: (string | undefined)[]) => {
		const q = query.trim().toLowerCase();
		return (
			!q || [name, ...more].some((s) => (s ?? '').toLowerCase().includes(q))
		);
	};
	const shown = $derived(
		(active === 'All'
			? [...library].sort(
					(a, b) => durationSeconds(a.workout) - durationSeconds(b.workout),
				)
			: byFocus(active)
		).filter((e) => matches(e.workout.name, e.focus, e.summary)),
	);
	const shownCustom = $derived(
		custom.all.filter((e) => matches(e.workout.name)),
	);
	const shelfEmpty = $derived(
		!custom.error && custom.loaded && custom.all.length === 0,
	);
</script>

<svelte:head><title>Workouts · WattRoom</title></svelte:head>

<main class="page">
	<div class="flex items-center gap-3">
		<div>
			<h1 class="page-title">Workouts</h1>
			<p class="text-muted text-xs">
				{library.length} curated workouts · every target scales to your FTP
			</p>
		</div>
	</div>

	{#if on}
		<div
			class="border-frame mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-sm"
			role="status"
		>
			<p class="min-w-0">
				Pick a workout for <span class="font-semibold"
					>{onName ?? 'your road'}</span
				> · Terrain Match picks the start
			</p>
			<a
				href="/workouts/routes/{encodeURIComponent(on)}"
				class="btn btn-ghost btn-xs">Cancel</a
			>
		</div>
	{/if}

	<!-- Its own row, above every shelf it filters (#3685). -->
	<input
		bind:value={query}
		type="search"
		placeholder="Find a workout or a route"
		aria-label="Find a workout or a route"
		class="input mt-6 w-full max-w-sm"
	/>

	<!-- Yours first: they are the ones you had to make on purpose. -->
	<section class="mt-8">
		<div class="flex min-h-7 flex-wrap items-center justify-between gap-3">
			<h2 class="eyebrow">your workouts</h2>
			{#if custom.full}
				<!-- The ceiling is said where the shelf is, not discovered on the
				     editor's Save (#1414, errors.md). -->
				<span class="text-muted text-xs"
					>{custom.max} workouts — the shelf is full. Delete one to build another.</span
				>
			{:else if !shelfEmpty}
				<!-- Buttons, not inline words (#2886): at 16 px they were under
				     ux.md's 24 px floor on a phone. An empty shelf's doors are its
				     empty state's alone (#3685). -->
				<!-- -mr-3: the last door's text, not its padding, meets the cards'
				     right edge. -->
				<span class="-mr-3 flex flex-wrap gap-1">
					<a href="/workouts/edit" class="btn btn-ghost btn-xs"
						>Build a workout</a
					>
					<!-- Both doors sit behind the same ceiling: an import lands on
					     this shelf exactly as a built workout does (#2327). -->
					<a href="/workouts/import" class="btn btn-ghost btn-xs"
						>Import a file</a
					>
				</span>
			{/if}
		</div>
		{#if custom.error}
			<!-- A shelf that could not be read is not an empty shelf (errors.md). -->
			<div class="mt-2">
				<Banner tone="error">
					{custom.error}
					{#snippet action()}
						<button onclick={() => void custom.retry()} class="btn-link text-xs"
							>Retry</button
						>
					{/snippet}
				</Banner>
			</div>
		{:else if !custom.loaded}
			<div class="mt-2 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
				<Skeleton class="h-40" rows={2} />
			</div>
		{:else if shelfEmpty}
			<div class="mt-2">
				<EmptyState>
					{#snippet icon()}<ListPlus size={20} class="text-muted" />{/snippet}
					Workouts you build or import land here and follow you to any device.
					{#snippet cta()}
						<a href="/workouts/edit" class="btn btn-primary btn-xs"
							>Build a workout</a
						>
						<a href="/workouts/import" class="btn btn-ghost btn-xs ml-2"
							>Import a file</a
						>
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			<!-- Each shelf says when the search emptied it (#3685). -->
			{#if shownCustom.length === 0}
				<p class="text-muted mt-2 text-sm">
					No workout of yours matches “{query.trim()}”.
				</p>
			{/if}
			<ul class="mt-2 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
				{#each shownCustom as entry (entry.id)}
					<WorkoutCard
						workout={entry.workout}
						href="/ride?w={entry.id}"
						ftp={previewFtp}
						menu={() => customMenu(entry)}
					>
						{#snippet actions()}
							<a href="/workouts/edit?w={entry.id}" class="btn btn-ghost btn-xs"
								>Edit</a
							>
							{@render ride(entry.id, entry.workout)}
							<span
								role="separator"
								aria-orientation="vertical"
								class="bg-muted/40 h-4 w-px shrink-0"
							></span>
							<button
								onclick={() => removeCustom(entry)}
								class="btn btn-ghost btn-xs text-danger">Delete</button
							>
						{/snippet}
					</WorkoutCard>
				{/each}
			</ul>
		{/if}
		{#if custom.dropped > 0}
			<p class="text-muted mt-2 text-xs">
				{custom.dropped === 1
					? 'One saved workout'
					: `${custom.dropped} saved workouts`} could not be read by this version
				and {custom.dropped === 1 ? 'is' : 'are'} not shown.
			</p>
		{/if}
	</section>

	<RouteShelf {query} />

	<!-- /ramp retires here (ADR-0020): a ramp test is a workout you start, not
	     a destination. It keeps its own ride screen — it writes your FTP — but
	     it is reached from the shelf. -->
	<div class="mt-8 flex min-h-7 items-center">
		<h2 class="eyebrow">measure</h2>
	</div>
	<ul class="mt-2">
		<li class="panel panel-lg flex flex-wrap items-center gap-x-4 gap-y-2">
			<Gauge size={16} class="text-muted shrink-0" />
			<div class="min-w-0 flex-1">
				<p class="font-display truncate text-base font-bold">Ramp test</p>
				<p class="text-muted mt-0.5 text-xs">
					Takes {RAMP_TAKES}. Sets your FTP, and suggests an LTHR from how it
					ended.
				</p>
			</div>
			<a href="/ramp" class="btn btn-accent btn-xs shrink-0">Start</a>
		</li>
	</ul>

	<div class="mt-8 flex min-h-7 items-center">
		<h2 class="eyebrow">curated</h2>
	</div>
	{#if suggestion && suggested.length > 0}
		<p class="text-muted mt-2 text-xs">
			Suggested for today:
			<span class="text-ink font-semibold">{suggested.join(' / ')}</span>
			— {suggestion.why}. Your call, always.
		</p>
	{/if}
	<div class="mt-2 flex flex-wrap gap-1">
		{#each ['All', ...focuses] as option (option)}
			<button
				onclick={() => (active = option as Focus | 'All')}
				class="rounded px-3 py-1.5 text-xs {active === option
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">{option}</button
			>
		{/each}
	</div>

	{#if shown.length === 0}
		<p class="text-muted mt-4 text-sm">
			No curated workout matches “{query.trim()}”.
		</p>
	{/if}
	<ul class="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
		{#each shown as entry (entry.id)}
			<WorkoutCard
				workout={entry.workout}
				href="/ride?w={entry.id}"
				ftp={previewFtp}
				focus={entry.focus}
				summary={entry.summary}
				menu={() => libraryMenu(entry.id, entry.workout)}
			>
				{#snippet badge()}
					{#if suggestion && suggested.includes(entry.focus)}
						<span class="eyebrow text-ok" title={suggestion.why}
							>suggested today</span
						>
					{/if}
				{/snippet}
				{#snippet actions()}
					<a href="/workouts/edit?from={entry.id}" class="btn btn-ghost btn-xs"
						>Save a copy</a
					>
					<!-- The primary action, visible (#126): the title-only link read
					     as a label, and the rest of the card was dead surface. -->
					{@render ride(entry.id, entry.workout)}
				{/snippet}
			</WorkoutCard>
		{/each}
	</ul>
	{#if routeFor}
		<RideOnRoute
			{...routeFor}
			road={on ?? undefined}
			onclose={() => (routeFor = null)}
		/>
	{/if}
</main>

<!-- A card's Ride, and On a route beside it; picking for a road, Ride is
     that road's (#3681). -->
{#snippet ride(id: string, workout: Workout)}
	{#if on}
		<button
			onclick={() => (routeFor = { id, workout })}
			class="btn btn-primary btn-xs ml-auto">Ride</button
		>
	{:else}
		{#if onRoads}
			<button
				onclick={() => (routeFor = { id, workout })}
				class="btn btn-ghost btn-xs ml-auto">On a route</button
			>
		{/if}
		<a
			href="/ride?w={id}"
			class="btn btn-primary btn-xs {onRoads ? '' : 'ml-auto'}">Ride</a
		>
	{/if}
{/snippet}
