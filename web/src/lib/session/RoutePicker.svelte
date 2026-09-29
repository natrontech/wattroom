<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import type { Snippet } from 'svelte';
	import RouteProfile from '$lib/components/RouteProfile.svelte';
	import { formatDuration } from '$lib/format';
	import { MaxLegSeconds, type ControlRoute } from '$lib/protocol';
	import { loadRoad } from '$lib/ride/roads';
	import { crewSeconds, rideTogether } from '$lib/road/ride-together';
	import { roadStep, type Road } from '$lib/road/road';
	import type { StoredRoute } from '$lib/road/stored';
	import { durationSeconds } from '$lib/workout/engine';
	import type { Workout } from '$lib/workout/types';

	/**
	 * Roads in the session picker (#3105): which of your routes, how the crew
	 * rides it, and which stretch. Its answer is `choice` — the road's own
	 * workout and the route the pick names — which the picker's one action
	 * starts or plans, like a workout. A route from Strava is listed and never
	 * pickable: it rides with its owner alone (ADR-0063).
	 */
	type Choice = { workout: Workout; route: ControlRoute; legs: number };
	let {
		routes,
		error,
		onRetry,
		choice = $bindable(),
		footer,
	}: {
		/** Null while the list is read. */
		routes: StoredRoute[] | null;
		error: string | null;
		onRetry: () => void;
		choice: Choice | null;
		/** The picker's one action, for the choice made here. */
		footer: Snippet<[Choice]>;
	} = $props();
	const list = $derived(routes ?? []);

	// Every road, read once, for the time filter and the profile. What was
	// asked for is not state: the effect re-runs on the list, never on the
	// answers, so a road in flight or refused is not asked for again.
	let roads = $state<Record<string, Road>>({});
	let roadError = $state<string | null>(null);
	const asked = new Set<string>();
	$effect(() => {
		for (const r of list)
			if (!r.ownerOnly && !asked.has(r.id)) {
				asked.add(r.id);
				void loadRoad(r.id).then((res) => {
					if (res.ok) roads = { ...roads, [r.id]: res.route.road };
					else roadError = res.error;
				});
			}
	});
	// The crew's pace for each road (#3105): the road workout the bunch rides.
	const minutes = (id: string) => {
		const r = list.find((route) => route.id === id);
		return r && roads[id]
			? Math.round(
					crewSeconds({
						id,
						genName: r.generatedName,
						road: roads[id],
						climbs: r.climbs,
					}) / 60,
				)
			: null;
	};

	// At most this far, this high, this long at the crew’s pace; empty is no bound.
	let maxKm = $state<number | null>(null);
	let maxUp = $state<number | null>(null);
	let maxHours = $state<number | null>(null);
	const shown = $derived(
		list.filter((r) => {
			const min = minutes(r.id);
			return (
				(maxKm === null || r.lengthM <= maxKm * 1000) &&
				(maxUp === null || r.gainM <= maxUp) &&
				(maxHours === null || min === null || min <= maxHours * 60)
			);
		}),
	);

	// The first route anyone may ride with the crew, until one is picked.
	let pickedId = $state('');
	const picked = $derived(
		list.find((r) => r.id === pickedId) ?? list.find((r) => !r.ownerOnly),
	);
	const road = $derived(picked ? roads[picked.id] : undefined);
	const classed = $derived(picked?.climbs.filter((c) => c.cls) ?? []);

	let stretch = $state<'whole' | 'climb' | 'from'>('whole');
	let climbAt = $state(0);
	let fromKm = $state(0);
	$effect(() => {
		if (!picked || !road) {
			choice = null;
			return;
		}
		const climb = classed[climbAt];
		const ridden =
			stretch === 'climb' && climb
				? { fromM: climb.startM, toM: climb.topM }
				: stretch === 'from'
					? {
							fromM: Math.min(
								Math.max(fromKm || 0, 0) * 1000,
								road.length - roadStep(road),
							),
							toM: road.length,
						}
					: { fromM: 0, toM: road.length };
		choice = rideTogether(
			{
				id: picked.id,
				genName: picked.generatedName,
				road,
				climbs: picked.climbs,
			},
			ridden,
		);
	});
</script>

{#if error}
	<p class="text-danger p-4 text-xs" role="alert">
		{error}
		<button onclick={onRetry} class="btn-link ml-1">Retry</button>
	</p>
{:else if routes === null}
	<p class="text-muted p-4 text-xs" aria-busy="true">Loading your routes…</p>
{:else if routes.length === 0}
	<!-- Teach, do not apologise (ux.md). -->
	<div class="p-4">
		<p class="text-sm font-medium">Ride your own roads.</p>
		<p class="text-muted mt-1 text-xs">
			Drop a GPX from Komoot or your Garmin and your crew rides it with you.
			<a href="/workouts/import" class="btn-link">Import a route</a>
		</p>
	</div>
{:else}
	<div class="flex min-h-0 flex-1 flex-col">
		<div class="flex min-h-0 flex-1 flex-col md:flex-row">
			<div
				class="border-ink/5 flex max-h-[38dvh] w-full shrink-0 flex-col border-b md:max-h-none md:w-72 md:border-r md:border-b-0"
			>
				<div class="grid grid-cols-3 gap-2 p-2 text-[11px]">
					<label class="text-muted">
						km at most
						<input
							type="number"
							min="1"
							bind:value={maxKm}
							class="input input-xs mt-1 w-full"
						/>
					</label>
					<label class="text-muted">
						m up at most
						<input
							type="number"
							min="0"
							bind:value={maxUp}
							class="input input-xs mt-1 w-full"
						/>
					</label>
					<label class="text-muted">
						hours at most
						<input
							type="number"
							min="0"
							step="0.5"
							bind:value={maxHours}
							class="input input-xs mt-1 w-full"
						/>
					</label>
				</div>
				<ul
					class="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
					aria-label="your routes"
				>
					{#each shown as r (r.id)}
						{@const min = minutes(r.id)}
						<li>
							<button
								onclick={() => (pickedId = r.id)}
								disabled={r.ownerOnly}
								class="w-full rounded px-3 py-2 text-left disabled:opacity-60 {picked?.id ===
								r.id
									? 'bg-surface-raised text-ink'
									: 'text-muted hover:text-ink'}"
							>
								<span class="block truncate text-sm font-medium">{r.name}</span>
								<span class="num block text-[11px]"
									>{(r.lengthM / 1000).toFixed(1)} km · {r.gainM} m{min !== null
										? ` · ${formatDuration(min * 60)}`
										: ''}</span
								>
								{#if r.ownerOnly}
									<span class="mt-1 flex items-center gap-1 text-[11px]"
										><Lock size={11} /> Only you can ride this one</span
									>
								{/if}
							</button>
						</li>
					{:else}
						<li class="text-muted px-3 py-4 text-xs">
							No route fits those bounds.
						</li>
					{/each}
				</ul>
			</div>

			<div class="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
				{#if !picked}
					<p class="text-muted text-sm">
						Your routes from Strava ride with you alone — import another to ride
						one together.
					</p>
				{:else}
					<p class="font-display font-bold">{picked.name}</p>
					{#if road}
						<div class="mt-3">
							<RouteProfile {road} climbs={picked.climbs} />
						</div>
					{:else if roadError}
						<p class="text-danger mt-3 text-xs" role="alert">{roadError}</p>
					{:else}
						<p class="text-muted mt-3 text-xs" aria-busy="true">
							Reading the road…
						</p>
					{/if}

					<p class="eyebrow mt-4">how</p>
					<div class="mt-2 flex flex-wrap gap-2">
						<button class="btn btn-secondary btn-lg" aria-pressed="true"
							>Ride it together</button
						>
						<button class="btn btn-ghost btn-lg" disabled>Race it</button>
					</div>
					<p class="text-muted mt-1 text-xs">
						The crew rides the road’s own workout, ERG by its grade; racing
						arrives with races.
					</p>

					<p class="eyebrow mt-4">which stretch</p>
					<div class="mt-2 flex flex-wrap items-center gap-2">
						<button
							onclick={() => (stretch = 'whole')}
							aria-pressed={stretch === 'whole'}
							class="btn {stretch === 'whole' ? 'btn-secondary' : 'btn-ghost'}"
							>The whole road</button
						>
						<button
							onclick={() => (stretch = 'climb')}
							aria-pressed={stretch === 'climb'}
							disabled={classed.length === 0}
							class="btn {stretch === 'climb' ? 'btn-secondary' : 'btn-ghost'}"
							>One climb</button
						>
						<button
							onclick={() => (stretch = 'from')}
							aria-pressed={stretch === 'from'}
							class="btn {stretch === 'from' ? 'btn-secondary' : 'btn-ghost'}"
							>From a km</button
						>
					</div>
					{#if stretch === 'climb' && classed.length > 0}
						<select
							bind:value={climbAt}
							class="input mt-2"
							aria-label="which climb"
						>
							{#each classed as c, i (c.startM)}
								<option value={i}
									>{c.cls} · {((c.topM - c.startM) / 1000).toFixed(1)} km from km
									{(c.startM / 1000).toFixed(1)}</option
								>
							{/each}
						</select>
					{:else if stretch === 'from'}
						<label class="text-muted mt-2 block text-xs">
							Start at km
							<input
								type="number"
								min="0"
								step="0.5"
								bind:value={fromKm}
								class="input mt-1 w-32"
							/>
						</label>
					{/if}

					{#if choice}
						<p class="text-muted mt-3 text-xs">
							<span class="num"
								>{formatDuration(durationSeconds(choice.workout))}</span
							>
							at the crew’s pace{choice.legs > 1
								? ` — the first of ${choice.legs} legs of at most ${MaxLegSeconds / 3600} h`
								: ''}.
						</p>
					{/if}
				{/if}
			</div>
		</div>
		{#if choice}
			<div class="border-ink/5 border-t p-4">{@render footer(choice)}</div>
		{/if}
	</div>
{/if}
