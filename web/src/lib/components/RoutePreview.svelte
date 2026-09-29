<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import { formatDuration } from '$lib/format';
	import { routePrivacyLine } from '$lib/privacy-copy';
	import {
		BikeKg,
		MaxLegSeconds,
		ReferenceRiderKg,
		ReferenceRiderWatts,
	} from '$lib/protocol';
	import { compileRoad } from '$lib/road/compile';
	import { planPath, profilePath } from '$lib/road/draw';
	import { kmAndClimb } from '$lib/road/profile';
	import { durationSeconds } from '$lib/workout/engine';
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

	const W = 600;
	const PLAN_H = 300;
	const PROFILE_H = 140;

	const route = $derived(imported.route);
	const plan = $derived(planPath(route.x, route.z, W, PLAN_H));
	const profile = $derived(profilePath(route.road.heights, W, PROFILE_H));
	const classed = $derived(route.climbs.filter((c) => c.cls));

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
		<span class="text-muted num ml-auto text-xs"
			>{kmAndClimb(route.length, route.gain)}{route.loop
				? ' · a loop'
				: ''}</span
		>
	</div>

	<div class="mt-3 grid gap-4 sm:grid-cols-[2fr_3fr]">
		<figure>
			<svg
				viewBox="0 0 {W} {PLAN_H}"
				width="100%"
				class="text-ink"
				role="img"
				aria-label="Your route from above, north up"
			>
				<path
					d={plan}
					fill="none"
					stroke="currentColor"
					stroke-width="3"
					stroke-linejoin="round"
				/>
			</svg>
			<figcaption class="text-muted mt-1 text-xs">
				From above, north up. Only you ever see this.
			</figcaption>
		</figure>
		<figure>
			<svg
				viewBox="0 0 {W} {PROFILE_H}"
				width="100%"
				preserveAspectRatio="none"
				class="text-ink h-28"
				role="img"
				aria-label="The road's heights by distance, its climbs shaded"
			>
				{#each classed as c (c.startM)}
					<rect
						x={(c.startM / route.road.length) * W}
						y="0"
						width={((c.topM - c.startM) / route.road.length) * W}
						height={PROFILE_H}
						class="fill-neon/15"
					/>
				{/each}
				<path
					d={profile}
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
			{#if classed.length > 0}
				<ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Climbs">
					{#each classed as c (c.startM)}
						<li class="border-neon/40 rounded border px-1.5 py-0.5 text-xs">
							<span class="font-display font-bold">{c.cls}</span>
							<span class="text-muted num"
								>{((c.topM - c.startM) / 1000).toFixed(1)} km · {Math.round(
									c.gainM,
								)} m</span
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-muted mt-2 text-xs">No classed climbs on this road.</p>
			{/if}
		</figure>
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
		<p class="text-muted mt-1 text-xs">
			Only you see this name. Your crews, friends, calendars, emails and Strava
			see “{route.name}”.
		</p>
	</div>

	<p class="text-muted mt-4 text-xs">{routePrivacyLine}</p>
</div>
