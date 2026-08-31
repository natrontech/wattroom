<script lang="ts">
	import type { Snippet } from 'svelte';
	import { play } from '$lib/sound/cues';
	import Logo from '$lib/brand/Logo.svelte';
	import MedalCard, { type Medal } from '$lib/components/MedalCard.svelte';
	import { ZONE_BG, ZONE_NAMES } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import {
		curvePoints,
		normalizedPower,
		rideXp,
		zoneSeconds,
		type RideSample,
	} from '$lib/ride/stats';

	// The post-session screen (#39's summary design): what you did, how well,
	// what it earned — every number a SPEC formula over the rider's own samples.
	let {
		title = 'Session complete',
		subtitle,
		samples,
		ftp,
		execution,
		medal,
		roomName = 'WattRoom',
		actions,
	}: {
		title?: string;
		subtitle: string;
		samples: RideSample[];
		ftp: number;
		execution: number;
		medal?: Medal;
		roomName?: string;
		actions?: Snippet;
	} = $props();

	const seconds = $derived(samples.length);
	const kj = $derived(
		Math.round(samples.reduce((sum, s) => sum + s.watts, 0) / 1000),
	);
	const avgWatts = $derived(
		seconds > 0
			? Math.round(samples.reduce((sum, s) => sum + s.watts, 0) / seconds)
			: 0,
	);
	const np = $derived(normalizedPower(samples));
	const zones = $derived(zoneSeconds(samples, ftp));
	const totalZoneSeconds = $derived(zones.reduce((a, b) => a + b, 0));
	const curve = $derived(curvePoints(samples));
	const xp = $derived(rideXp(kj, execution));

	// A medal announces itself once (SPEC: promotions announce, drops do not).
	let cheered = false;
	$effect(() => {
		if (medal && !cheered) {
			cheered = true;
			play('fanfare');
		}
	});
</script>

<div class="mx-auto max-w-5xl">
	<header class="flex items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">{title}</h1>
			<p class="text-muted text-xs">{subtitle}</p>
		</div>
	</header>

	<!-- Headline numbers first: what you did, how well, what it earned. -->
	<section class="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each [{ label: 'duration', value: formatClock(seconds) }, { label: 'work', value: `${kj} kJ` }, { label: 'execution', value: `${Math.round(execution * 100)}%` }, { label: 'normalised', value: `${np} W` }] as stat (stat.label)}
			<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
				<div class="font-display text-3xl leading-none font-bold tabular-nums">
					{stat.value}
				</div>
				<div class="text-muted mt-2 text-[10px] tracking-wider uppercase">
					{stat.label}
				</div>
			</div>
		{/each}
	</section>

	<div class="mt-3 grid gap-3 {medal ? 'lg:grid-cols-[1fr_400px]' : ''}">
		<div class="grid gap-3">
			<section class="border-muted/15 bg-surface-raised rounded-lg border p-5">
				<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
					time in zone
				</h2>
				{#if totalZoneSeconds > 0}
					<div class="mt-4 flex h-3 overflow-hidden rounded-full">
						{#each zones as zsec, zone (zone)}
							{#if zsec > 0}
								<div
									class={ZONE_BG[zone]}
									style="width: {(zsec / totalZoneSeconds) * 100}%"
									title="{ZONE_NAMES[zone]}: {formatClock(zsec)}"
								></div>
							{/if}
						{/each}
					</div>
					<ul class="mt-4 grid gap-1.5 sm:grid-cols-2">
						{#each zones as zsec, zone (zone)}
							{#if zsec > 0}
								<li class="flex items-center gap-2 text-xs">
									<span class="h-2 w-2 shrink-0 rounded-full {ZONE_BG[zone]}"
									></span>
									<span class="text-muted">Z{zone} {ZONE_NAMES[zone]}</span>
									<span class="ml-auto font-mono tabular-nums"
										>{formatClock(zsec)}</span
									>
								</li>
							{/if}
						{/each}
					</ul>
				{:else}
					<p class="text-muted mt-3 text-xs">No riding recorded.</p>
				{/if}
			</section>

			<section class="border-muted/15 bg-surface-raised rounded-lg border p-5">
				<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
					power curve
				</h2>
				<div class="mt-4 grid grid-cols-4 gap-3">
					{#each curve as point (point.label)}
						<div>
							<div
								class="font-display text-2xl leading-none font-bold tabular-nums"
							>
								{point.watts > 0 ? point.watts : '–'}
							</div>
							<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
								{point.label}
							</div>
						</div>
					{/each}
				</div>
			</section>

			<section class="border-muted/15 bg-surface-raised rounded-lg border p-5">
				<div class="flex items-baseline gap-3">
					<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
						progress
					</h2>
					<span class="text-muted ml-auto font-mono text-[11px] tabular-nums"
						>+{xp} XP</span
					>
				</div>
				<ul
					class="text-muted mt-3 space-y-1 font-mono text-[11px] tabular-nums"
				>
					<li class="flex">
						<span>{kj} kJ ridden</span><span class="ml-auto">+{kj}</span>
					</li>
					<li class="flex">
						<span>execution bonus</span><span class="ml-auto"
							>+{Math.round(execution * 50)}</span
						>
					</li>
				</ul>
				<p class="text-muted mt-2 text-[11px]">
					Streak bonus and level land on your account with the ride.
				</p>
			</section>
		</div>

		{#if medal}
			<div>
				<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
					your medal
				</h2>
				<div class="mt-3">
					<MedalCard {medal} {roomName} />
				</div>
				{#if actions}
					<div class="mt-3">{@render actions()}</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if !medal && actions}
		<div class="mt-3">{@render actions()}</div>
	{/if}
</div>
