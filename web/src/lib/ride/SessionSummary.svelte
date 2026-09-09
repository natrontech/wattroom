<script lang="ts">
	import type { Snippet } from 'svelte';
	import { play } from '$lib/sound/cues';
	import Logo from '$lib/brand/Logo.svelte';
	import MedalCard, { type Medal } from '$lib/components/MedalCard.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { formatClock } from '$lib/format';
	import {
		curvePoints,
		normalizedPower,
		powerTrace,
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
		riders,
		actions,
	}: {
		title?: string;
		subtitle: string;
		samples: RideSample[];
		ftp: number;
		/** Absent when nothing scorable was ridden: shown as a dash, no bonus (#1454). */
		execution?: number;
		medal?: Medal;
		roomName?: string;
		/**
		 * Who rode it with you (#1559): the room's roster at the close. Absent
		 * on a solo ride, and the card adapts rather than forking — solo and
		 * room are one card (#1531).
		 */
		riders?: { id: string; name: string; execution?: number; you?: boolean }[];
		actions?: Snippet;
	} = $props();

	// The ride second by second (#1559): the screen a rider looks at while
	// catching their breath drew nothing, and the data was in memory.
	const TRACE_W = 600;
	const TRACE_H = 120;
	const trace = $derived(powerTrace(samples, ftp, TRACE_W, TRACE_H));

	const seconds = $derived(samples.length);
	// Floored like the server's column — XP derives from it on both sides.
	const kj = $derived(
		Math.floor(samples.reduce((sum, s) => sum + s.watts, 0) / 1000),
	);
	const np = $derived(normalizedPower(samples));
	const zones = $derived(zoneSeconds(samples, ftp));
	const totalZoneSeconds = $derived(zones.reduce((a, b) => a + b, 0));
	const curve = $derived(curvePoints(samples));
	// The windows the ride was long enough for (#1559): two of four slots
	// were dashes on any ride under five minutes, which read as broken.
	const reached = $derived(curve.filter((point) => point.watts > 0));
	const unreached = $derived(
		curve.filter((point) => point.watts === 0).map((point) => point.label),
	);
	const together = $derived(
		riders
			? [...riders].sort(
					(a, b) =>
						Number(!!b.you) - Number(!!a.you) ||
						(b.execution ?? -1) - (a.execution ?? -1),
				)
			: [],
	);
	const xp = $derived(rideXp(kj, execution ?? 0));

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
		{#each [{ label: 'duration', value: formatClock(seconds) }, { label: 'work', value: `${kj} kJ` }, { label: 'execution', value: execution === undefined ? '—' : `${Math.round(execution * 100)}%` }, { label: 'normalised', value: `${np} W` }] as stat (stat.label)}
			<div class="panel p-5">
				<div class="font-display text-3xl leading-none font-bold tabular-nums">
					{stat.value}
				</div>
				<div class="eyebrow mt-2">
					{stat.label}
				</div>
			</div>
		{/each}
	</section>

	<div class="mt-3 grid gap-3 {medal ? 'lg:grid-cols-[1fr_400px]' : ''}">
		<div class="grid gap-3">
			<section class="panel p-5">
				<h2 class="eyebrow">time in zone</h2>
				{#if totalZoneSeconds > 0}
					<div class="mt-4">
						<ZoneBar seconds={zones} legend />
					</div>
				{:else}
					<p class="text-muted mt-3 text-xs">No riding recorded.</p>
				{/if}
			</section>

			{#if trace}
				<section class="panel p-5">
					<h2 class="eyebrow">how it went</h2>
					<!-- viewBox and a percentage width, never a pixel width beside a
					     measured container (ux.md): it has to fit a phone. -->
					<svg
						viewBox="0 0 {TRACE_W} {TRACE_H}"
						width="100%"
						height={TRACE_H}
						preserveAspectRatio="none"
						class="mt-3 block"
						role="img"
						aria-label="power over the ride, against your FTP"
					>
						<line
							x1="0"
							x2={TRACE_W}
							y1={trace.ftpY}
							y2={trace.ftpY}
							stroke="currentColor"
							stroke-width="1"
							stroke-dasharray="4 4"
							class="text-neon opacity-60"
						/>
						<path
							d={trace.path}
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							vector-effect="non-scaling-stroke"
							class="text-watt"
						/>
					</svg>
					<p class="text-muted mt-1 text-[11px]">
						Power, second by second — the dashed line is your FTP ({ftp} W).
					</p>
				</section>
			{/if}

			<section class="panel p-5">
				<h2 class="eyebrow">power curve</h2>
				<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
					{#each reached as point (point.label)}
						<div>
							<div
								class="font-display text-2xl leading-none font-bold tabular-nums"
							>
								{point.watts}
							</div>
							<div class="eyebrow mt-1">
								{point.label}
							</div>
						</div>
					{/each}
				</div>
				{#if unreached.length > 0}
					<p class="text-muted mt-3 text-[11px]">
						{unreached.join(' and ')} need a longer ride.
					</p>
				{/if}
			</section>

			{#if together.length > 1}
				<!-- The moment the session ends is when who was there matters
				     (#1559): the card used to report one person's numbers. -->
				<section class="panel p-5">
					<h2 class="eyebrow">who rode</h2>
					<ul class="mt-3 grid gap-1.5 sm:grid-cols-2">
						{#each together as rider (rider.id)}
							<li class="flex items-baseline gap-2 text-sm">
								<span class="truncate {rider.you ? 'font-medium' : ''}"
									>{rider.you ? 'You' : rider.name}</span
								>
								{#if rider.execution !== undefined}
									<span
										class="text-muted ml-auto font-mono text-xs tabular-nums"
										>{Math.round(rider.execution * 100)}%</span
									>
								{/if}
							</li>
						{/each}
					</ul>
					<p class="text-muted mt-2 text-[11px]">Execution — time on target.</p>
				</section>
			{/if}

			<section class="panel p-5">
				<div class="flex items-baseline gap-3">
					<h2 class="eyebrow">progress</h2>
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
							>+{Math.round((execution ?? 0) * 50)}</span
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
				<h2 class="eyebrow">your medal</h2>
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
