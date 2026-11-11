<script lang="ts">
	import FileUp from '@lucide/svelte/icons/file-up';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { account } from '#lib/account.svelte.ts';
	import { api } from '#lib/api.ts';
	import { withBack } from '#lib/back-link.ts';
	import Banner from '#lib/components/Banner.svelte';
	import RouteProfile from '#lib/components/RouteProfile.svelte';
	import RouteRow from '#lib/components/RouteRow.svelte';
	import RouteShape from '#lib/components/RouteShape.svelte';
	import RouteStatRow from '#lib/components/RouteStatRow.svelte';
	import SectionTabs from '#lib/components/SectionTabs.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import { device, isSpectator } from '#lib/device.svelte.ts';
	import { fileDrop, handFiles } from '#lib/file-drop.svelte.ts';
	import { formatDuration } from '#lib/format.ts';
	import { workoutSections } from '#lib/nav/pages.ts';
	import { routePrivacyLine } from '#lib/privacy-copy.ts';
	import {
		HOME_ROADS,
		homeRoad,
		homeRow,
		homeShape,
	} from '#lib/ride/home-roads.ts';
	import { loadRoad, myRoutes } from '#lib/ride/roads.ts';
	import { isLoop } from '#lib/road/line.ts';
	import type { Road } from '#lib/road/road.ts';
	import {
		fitsBounds,
		ROUTE_BOUNDS,
		secondsAtPace,
		type RouteBounds,
	} from '#lib/road/route-filter.ts';
	import { shapeLine, statRow, type StoredRoute } from '#lib/road/stored.ts';
	import RideHow from './[id]/RideHow.svelte';

	/**
	 * Every road a rider can ride, under Workouts (#3692): pick one in the
	 * rail, see it, then how to ride it. On a desk the road and its How sit
	 * beside the rail and the pick lives in `?r=`; a phone has the rail only,
	 * and a row opens the route's own page.
	 */
	const desk = new MediaQuery('min-width: 1024px');
	const HERE = '/workouts/routes';

	let routes = $state<StoredRoute[] | null>(null);
	let error = $state<string | null>(null);
	async function load() {
		error = null;
		const res = await myRoutes();
		if (res.ok) routes = res.routes;
		else error = res.error;
	}
	void load();

	let homes = $state<StoredRoute[] | null>(null);
	void Promise.all(HOME_ROADS.map(homeRow)).then((r) => (homes = r));

	// Every road, read once, for its time at your pace and its drawing. What
	// was asked for is not state, so a road in flight is not asked for again.
	let roads = $state.raw<Record<string, Road>>({});
	let roadErrors = $state<Record<string, string>>({});
	const asked = new Set<string>();
	$effect(() => {
		for (const r of [...(routes ?? []), ...(homes ?? [])])
			if (!asked.has(r.id)) {
				asked.add(r.id);
				void loadRoad(r.id).then((res) => {
					if (res.ok) roads = { ...roads, [r.id]: res.route.road };
					else roadErrors = { ...roadErrors, [r.id]: res.error };
				});
			}
	});

	// Without both an FTP and a weight there is no "your pace" to filter by.
	const ftp = $derived(account.me?.ftpWatts || null);
	const kg = $derived(account.me?.weightKg || null);
	const times = $derived.by(() => {
		const out: Record<string, number> = {};
		if (!ftp || !kg) return out;
		for (const r of [...(routes ?? []), ...(homes ?? [])]) {
			const road = roads[r.id];
			if (road)
				out[r.id] = secondsAtPace(
					{ id: r.id, genName: r.generatedName, road, climbs: r.climbs },
					ftp,
					kg,
				);
		}
		return out;
	});

	let bounds = $state<RouteBounds>({ km: null, up: null, hours: null });
	const toggle = (key: keyof RouteBounds, value: number) =>
		(bounds[key] = bounds[key] === value ? null : value);

	// A source is a tab only where it has roads; one source needs no tabs.
	const r = $derived(page.url.searchParams.get('r'));
	let chosen = $state<'yours' | 'wattroom' | null>(null);
	const hasOwn = $derived((routes?.length ?? 0) > 0);
	const source = $derived(
		hasOwn ? (chosen ?? (r && homeRoad(r) ? 'wattroom' : 'yours')) : 'wattroom',
	);
	const rows = $derived(source === 'yours' ? routes : homes);
	const shown = $derived(
		(rows ?? []).filter((x) => fitsBounds(x, times[x.id] ?? null, bounds)),
	);
	const selected = $derived(shown.find((x) => x.id === r) ?? shown[0] ?? null);
	const selectedId = $derived(selected?.id ?? null);
	const road = $derived(selectedId ? roads[selectedId] : undefined);

	let shape = $state<{ x: number[]; z: number[] } | null>(null);
	let shapeNote = $state<string | null>(null);
	$effect(() => {
		const id = selectedId;
		shape = null;
		shapeNote = null;
		if (!id || !desk.current) return;
		const sel = untrack(() => selected);
		const home = homeRoad(id);
		if (home) {
			void homeShape(home).then((s) => {
				if (selectedId === id) shape = s;
			});
		} else if (sel && !sel.hasPlace) {
			shapeNote = sel.hint ?? 'This route kept its heights, not its map.';
		} else {
			void api<{ shape: string }>(
				`/api/routes/${encodeURIComponent(id)}/shape`,
			).then((res) => {
				if (selectedId !== id) return;
				if (res.ok) shape = shapeLine(res.data.shape);
				else shapeNote = res.error.message;
			});
		}
	});
	const loop = $derived(shape ? isLoop({ ...shape, e: [] }) : undefined);

	const rideHref = (x: StoredRoute) =>
		`/ride?road=${encodeURIComponent(x.id)}${x.carryOnM !== undefined ? `&from=${Math.floor(x.carryOnM)}` : ''}`;

	// The rail's last card takes a file by drag and hands it to the importer.
	const drop = fileDrop((files) => {
		handFiles(files);
		void goto('/workouts/import?as=route');
	});

	const chip = (on: boolean) =>
		`btn btn-xs rounded-full border ${on ? 'border-neon text-ink' : 'border-muted/30 hover:border-muted/60'}`;
	const groups = $derived([
		{
			key: 'km' as const,
			label: 'Distance',
			values: ROUTE_BOUNDS.km,
			say: (v: number) => `up to ${v} km`,
		},
		{
			key: 'up' as const,
			label: 'Climbing',
			values: ROUTE_BOUNDS.up,
			say: (v: number) => `up to ${v.toLocaleString('en')} m`,
		},
		...(ftp && kg
			? [
					{
						key: 'hours' as const,
						label: 'At your pace',
						values: ROUTE_BOUNDS.hours,
						say: (v: number) => `up to ${v} h`,
					},
				]
			: []),
	]);
</script>

<svelte:head><title>Routes · WattRoom</title></svelte:head>

<main class="page">
	<SectionTabs
		tabs={workoutSections}
		current={HERE}
		label="workouts sections"
	/>
	<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
		<h1 class="page-title">Routes</h1>
		<a href="/workouts/import?as=route" class="btn btn-secondary"
			>Import a route</a
		>
	</div>

	{#if error}
		<!-- A list that could not be read is not an empty list. -->
		<div class="mt-6">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if routes === null || homes === null}
		<div
			class="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]"
			aria-busy="true"
		>
			<Skeleton class="h-16" rows={3} />
			<Skeleton class="hidden h-[280px] lg:block" />
			<Skeleton class="hidden h-40 xl:block" />
		</div>
	{:else}
		{#if hasOwn}
			<div class="mt-4 flex flex-wrap gap-1" role="group" aria-label="source">
				{#each [{ key: 'yours', label: 'Your routes' }, { key: 'wattroom', label: 'WattRoom roads' }] as const as s (s.key)}
					<button
						onclick={() => (chosen = s.key)}
						aria-pressed={source === s.key}
						class="rounded px-3 py-1.5 text-xs {source === s.key
							? 'bg-surface-raised text-ink'
							: 'text-muted hover:text-ink'}">{s.label}</button
					>
				{/each}
			</div>
		{:else}
			<!-- Teach, do not apologise: one line, and the doors are on the page. -->
			<p class="text-muted mt-4 text-sm">
				Your routes ride here — import a GPX, TCX or FIT.
			</p>
		{/if}

		<div class="mt-4 flex flex-wrap gap-x-6 gap-y-2">
			{#each groups as g (g.key)}
				<div
					class="flex flex-wrap items-center gap-2"
					role="group"
					aria-label={g.label}
				>
					<span class="eyebrow">{g.label}</span>
					{#each g.values as v (v)}
						<button
							onclick={() => toggle(g.key, v)}
							aria-pressed={bounds[g.key] === v}
							class={chip(bounds[g.key] === v)}>{g.say(v)}</button
						>
					{/each}
				</div>
			{/each}
		</div>

		<div
			class="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start xl:grid-cols-[240px_minmax(0,1fr)_300px]"
		>
			<div class="flex min-w-0 flex-col gap-2 lg:row-span-2 xl:row-span-1">
				<ul
					class="grid gap-2"
					aria-label={source === 'yours' ? 'your routes' : 'WattRoom roads'}
					data-sveltekit-reset="false"
				>
					{#each shown as x (x.id)}
						{@const t = times[x.id]}
						<li class="min-w-0">
							<RouteRow
								route={x}
								selected={desk.current && selected?.id === x.id}
								extra={t !== undefined ? formatDuration(t) : undefined}
								note={homeRoad(x.id)?.story}
								href={desk.current
									? `${HERE}?r=${encodeURIComponent(x.id)}`
									: undefined}
							>
								{#snippet action()}
									{#if !desk.current}
										<a href={rideHref(x)} class="btn btn-primary btn-xs"
											>{x.carryOnM !== undefined ? 'Carry on' : 'Ride'}</a
										>
									{/if}
								{/snippet}
							</RouteRow>
						</li>
					{:else}
						<li class="text-muted px-3 py-4 text-xs">
							No route fits those bounds.
						</li>
					{/each}
				</ul>
				<a
					href="/workouts/import?as=route"
					{...drop.on}
					class="text-muted flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm transition-colors {drop.over
						? 'border-neon bg-neon/5'
						: 'border-muted/25 hover:border-muted/60'}"
				>
					<FileUp size={16} class="shrink-0" />
					Drop a GPX, TCX or FIT
				</a>
				<p class="text-muted text-xs">{routePrivacyLine}</p>
			</div>

			{#if desk.current && selected}
				<section
					class="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1"
					aria-label="the road"
				>
					<div>
						<h2 class="font-display text-lg font-bold">
							<a
								href={withBack(
									`${HERE}/${encodeURIComponent(selected.id)}`,
									`${HERE}?r=${encodeURIComponent(selected.id)}`,
								)}
								class="hover:underline">{selected.name}</a
							>
						</h2>
						<RouteStatRow parts={statRow(selected, loop)} />
					</div>
					{#if shape || shapeNote}
						<RouteShape
							x={shape?.x}
							z={shape?.z}
							climbs={selected.climbs}
							length={road?.length}
							note={shapeNote ?? undefined}
							mine={!homeRoad(selected.id)}
						/>
					{:else}
						<Skeleton class="h-[220px] sm:h-[280px]" />
					{/if}
					{#if road}
						<RouteProfile {road} climbs={selected.climbs} />
					{:else if roadErrors[selected.id]}
						<Banner tone="error">{roadErrors[selected.id]}</Banner>
					{:else}
						<Skeleton class="h-36" />
					{/if}
				</section>
				<aside
					class="lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1"
					aria-label="how to ride it"
				>
					{#if road}
						{#key selected.id}
							<RideHow
								id={selected.id}
								length={road.length}
								climbs={selected.climbs}
								carry={selected.carryOnM ?? null}
								spectator={isSpectator(device)}
							/>
						{/key}
					{:else if !roadErrors[selected.id]}
						<Skeleton class="h-40" />
					{/if}
				</aside>
			{/if}
		</div>
	{/if}
</main>
