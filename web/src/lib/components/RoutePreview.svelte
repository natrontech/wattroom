<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import { formatDuration } from '$lib/format';
	import { routeNameLine, routePrivacyLine } from '$lib/privacy-copy';
	import {
		BikeKg,
		MaxLegSeconds,
		ReferenceRiderKg,
		ReferenceRiderWatts,
	} from '$lib/protocol';
	import { compileRoad } from '$lib/road/compile';
	import { durationSeconds } from '$lib/workout/engine';
	import RouteProfile from './RouteProfile.svelte';
	import RouteShape from './RouteShape.svelte';
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
	}: {
		imported: ImportedRoute;
		/** The rider's own FTP and weight; without both there is no "your pace". */
		ftp: number | null;
		riderKg: number | null;
		/** The owner's own name for it, empty for none. */
		rename: string;
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
</script>

<div>
	<div
		class="border-frame flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2"
	>
		<h2 class="font-display min-w-0 truncate text-base font-bold">
			{route.name}
		</h2>
		<span class="text-muted ml-auto text-xs"
			>{route.loop ? 'A loop' : 'Point to point'}</span
		>
	</div>

	<div class="mt-3 grid gap-4 sm:grid-cols-[2fr_3fr]">
		<RouteShape x={route.x} z={route.z} />
		<RouteProfile road={route.road} climbs={route.climbs} />
	</div>

	<dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
		{#if yours !== null}
			<dt class="text-muted">At your pace</dt>
			<dd>
				<span class="num">{formatDuration(yours)}</span>
				<span class="text-muted">— ERG by the road, at your FTP</span>
			</dd>
		{/if}
		<dt class="text-muted">At the reference pace</dt>
		<dd>
			<span class="num">{formatDuration(imported.referenceSeconds)}</span>
			<span class="text-muted"
				>— {ReferenceRiderWatts} W, {ReferenceRiderKg} kg</span
			>
		</dd>
	</dl>
	{#if imported.legs > 1}
		<p class="mt-2 text-xs">
			Longer than {MaxLegSeconds / 3600} h at the reference pace, so it rides in
			{imported.legs} legs — each one starts where the last one stopped.
		</p>
	{/if}

	<div class="mt-4">
		<h3 class="eyebrow">what we fixed</h3>
		{#if imported.fixes.length > 0}
			<ul class="mt-2 space-y-1.5">
				{#each imported.fixes as fix (fix)}
					<li class="text-muted flex gap-2 text-xs">
						<Info size={14} class="mt-px shrink-0" />
						<span>{fix}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted mt-2 text-xs">
				Nothing needed fixing beyond the smoothing every route gets.
			</p>
		{/if}
	</div>

	<div class="mt-4">
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

	<p class="text-muted mt-4 text-xs">{routePrivacyLine}</p>
</div>
