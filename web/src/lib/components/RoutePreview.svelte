<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import type { Snippet } from 'svelte';
	import { formatDuration } from '$lib/format';
	import RecapTiles from '$lib/ride/RecapTiles.svelte';
	import { routeNameLine, routePrivacyLine } from '$lib/privacy-copy';
	import {
		BikeKg,
		MaxLegSeconds,
		ReferenceRiderKg,
		ReferenceRiderWatts,
	} from '$lib/protocol';
	import { compileRoad } from '$lib/road/compile';
	import { statRow } from '$lib/road/stored';
	import { durationSeconds } from '$lib/workout/engine';
	import RouteProfile from './RouteProfile.svelte';
	import RouteShape from './RouteShape.svelte';
	import RouteStatRow from './RouteStatRow.svelte';
	import type { ImportedRoute } from '$lib/workout/import';

	/**
	 * What a route file became, before anything is stored (#3057): its shape —
	 * the owner's, drawn in their own browser and nowhere else — its profile
	 * and climbs, how long it rides, what was fixed on the way, and the name it
	 * goes out under beside the one only its owner sees.
	 */
	let {
		imported,
		ftp,
		riderKg,
		rename = $bindable(),
		actions,
	}: {
		imported: ImportedRoute;
		/** The rider's own FTP and weight; without both there is no "your pace". */
		ftp: number | null;
		riderKg: number | null;
		/** The owner's own name for it, empty for none. */
		rename: string;
		/** Save and the rides, under the name in the right-hand column. */
		actions?: Snippet;
	} = $props();

	const route = $derived(imported.route);

	// The road ridden as its road workout — ERG by the road — timed at the
	// rider's own FTP and weight, which is what "Ride it now" will ride.
	const yours = $derived(
		ftp && riderKg
			? compileRoad(
					{
						id: '',
						genName: route.name,
						road: route.road,
						climbs: route.climbs,
					},
					ftp,
					riderKg + BikeKg,
				).reduce((total, leg) => total + durationSeconds(leg), 0)
			: null,
	);

	const tiles = $derived([
		...(yours === null
			? []
			: [{ label: 'At your pace', value: formatDuration(yours) }]),
		{
			label: 'At the reference pace',
			value: formatDuration(imported.referenceSeconds),
			unit: `${ReferenceRiderWatts} W · ${ReferenceRiderKg} kg`,
		},
	]);
</script>

<div>
	<h2 class="page-title-sm min-w-0 truncate">{route.name}</h2>
	<RouteStatRow
		parts={statRow(
			{
				lengthM: route.length,
				gainM: Math.round(route.gain),
				climbs: route.climbs,
			},
			route.loop,
		)}
	/>

	<!-- The route page's split: the drawings on the left, the tiles, the name
	     and the actions in a 300 px column on the right, so Save stays above
	     the fold on a desk. -->
	<div
		class="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
	>
		<div class="flex min-w-0 flex-col gap-4">
			<RouteShape
				x={route.x}
				z={route.z}
				climbs={route.climbs}
				length={route.road.length}
			/>
			<RouteProfile road={route.road} climbs={route.climbs} />
			{#if imported.fixes.length > 0}
				<div>
					<h3 class="eyebrow">what we fixed</h3>
					<ul class="mt-2 space-y-1.5">
						{#each imported.fixes as fix (fix)}
							<li class="text-muted flex gap-2 text-xs">
								<Info size={14} class="mt-px shrink-0" />
								<span>{fix}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<div class="flex min-w-0 flex-col gap-4">
			<div>
				<RecapTiles {tiles} label="the road in time" />
				{#if imported.legs > 1}
					<p class="mt-2 text-xs">
						Longer than {MaxLegSeconds / 3600} h at the reference pace, so it rides
						in {imported.legs} legs — each one starts where the last one stopped.
					</p>
				{/if}
			</div>
			<div>
				<label for="route-rename" class="eyebrow">your name for it</label>
				<input
					id="route-rename"
					bind:value={rename}
					maxlength="80"
					placeholder={route.name}
					class="input mt-1 w-full"
				/>
				<p class="text-muted mt-1 text-xs">{routeNameLine(route.name)}</p>
			</div>
			{@render actions?.()}
			<p class="text-muted text-xs">{routePrivacyLine}</p>
		</div>
	</div>
</div>
