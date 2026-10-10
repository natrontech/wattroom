<script lang="ts">
	import type { Snippet } from 'svelte';
	import { play } from '$lib/sound/cues';
	import MedalCard, { type Medal } from '$lib/components/MedalCard.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { ZONE_VAR, zoneOf } from '$lib/components/zones';
	import RecapHeader from '$lib/ride/RecapHeader.svelte';
	import RecapTiles from '$lib/ride/RecapTiles.svelte';
	import {
		recapEyebrow,
		recapTiles,
		type RideKind,
	} from '$lib/ride/recap-frame';
	import {
		averageWatts,
		curvePoints,
		normalizedPower,
		powerTrace,
		xpLines,
		zoneSeconds,
		type RideSample,
	} from '$lib/ride/stats';

	// The closing card (#39's summary design, framed by #3686): what you did,
	// how well, what it earned — every number a SPEC formula over the rider's
	// own samples. It spans the column it is given; the actions ride the
	// header and the numbers sit under it, so neither waits below the fold.
	let {
		title,
		kind = 'Workout',
		crew,
		samples,
		ftp,
		execution,
		medal,
		placeName = 'WattRoom',
		riders,
		actions,
		status,
		unsaved = false,
		savedXp,
	}: {
		/** The ride's name: the workout's, or the road's. */
		title: string;
		kind?: RideKind;
		/** The crew a session rode with; absent on a ride alone. */
		crew?: string;
		samples: RideSample[];
		ftp: number;
		/** Absent when nothing scorable was ridden: shown as a dash, no bonus (#1454). */
		execution?: number;
		medal?: Medal;
		placeName?: string;
		/**
		 * Who rode it with you (#1559): the session's roster at the close.
		 * Absent on a solo ride, and the card adapts rather than forking — solo
		 * and session are one card (#1531).
		 */
		riders?: { id: string; name: string; execution?: number; you?: boolean }[];
		/** Secondary actions first, Done last (RecapHeader). */
		actions?: Snippet;
		/** What the save or the export said, under the header (errors.md). */
		status?: Snippet;
		/** The save failed (#2634): none of the XP below reached the account. */
		unsaved?: boolean;
		/** The saved ride's own XP, streak bonus in it (#3753): what the ride page reads. */
		savedXp?: number;
	} = $props();

	// The ride second by second (#1559): the screen a rider looks at while
	// catching their breath drew nothing, and the data was in memory.
	const TRACE_W = 600;
	const TRACE_H = 120;
	const trace = $derived(powerTrace(samples, ftp, TRACE_W, TRACE_H));
	// The trace, coloured by effort (#1559): a flat stroke said how hard it was
	// only to someone reading the FTP line against it. Every column takes the
	// colour of the zone it was ridden at — the same mark the downloadable ride
	// card draws, from the same buckets the path above is drawn from.
	const columns = $derived(
		(trace?.columns ?? []).map((column) => ({
			...column,
			y: TRACE_H - (column.watts / (trace?.top ?? 1)) * TRACE_H,
			zone: zoneOf(column.watts, ftp),
		})),
	);

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
	const xp = $derived(xpLines(kj, execution ?? 0, savedXp));
	// The day it closed, kept: a card left open past midnight stays Monday's.
	const closedAt = new Date();
	const eyebrow = $derived(recapEyebrow(closedAt, kind, crew));
	// The ride page's six (#3687 reads the same builder). An unsaved ride
	// earned nothing on the account, so its tile goes rather than promise it.
	const tiles = $derived(
		recapTiles({
			seconds,
			kj,
			avgWatts: averageWatts(samples),
			normWatts: np,
			execution,
			xp: unsaved ? undefined : xp.total,
		}),
	);

	// A medal announces itself once (SPEC: promotions announce, drops do not).
	let cheered = false;
	$effect(() => {
		if (medal && !cheered) {
			cheered = true;
			play('fanfare');
		}
	});
</script>

<article class="w-full" data-testid="closing-card">
	<RecapHeader {eyebrow} {title} {actions} />

	{#if status}
		<div class="has-[*]:mt-3">{@render status()}</div>
	{/if}

	<!-- Desk (≥ 1280): the trace and the zones on the left at 470 px, the rest
	     on the right, tops aligned. Narrower, one column in reading order —
	     the numbers, then the trace, then the rest (TARGETS.md closing-card). -->
	<div
		class="mt-4 grid items-start gap-4 xl:grid-cols-[470px_minmax(0,1fr)] xl:grid-rows-[auto_1fr]"
	>
		<div class="xl:col-start-2 xl:row-start-1">
			<RecapTiles {tiles} />
		</div>

		<section
			class="panel panel-lg xl:col-start-1 xl:row-span-2 xl:row-start-1 xl:self-stretch"
			data-testid="recap-trace"
		>
			{#if trace}
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
					<!-- A column per bucket, in the colour of the zone it was
					     ridden at — not a gradient up the axis, which paints the
					     bottom of a threshold effort Z1 because that is the height
					     it passes through. Column by column is how hard it was
					     *then*, which is the question. -->
					{#each columns as column (column.x)}
						<rect
							x={column.x}
							y={column.y}
							width={column.width}
							height={TRACE_H - column.y}
							fill={ZONE_VAR[column.zone]}
							fill-opacity="0.55"
						/>
						<!-- The lit edge, at rest: the same mark the downloadable
						     card draws, and the only thing here at full strength. -->
						<rect
							x={column.x}
							y={column.y}
							width={column.width}
							height={Math.min(2, TRACE_H - column.y)}
							fill={ZONE_VAR[column.zone]}
						/>
					{/each}
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
				</svg>
				<p class="text-muted mt-1 text-[11px]">
					Power, second by second — the dashed line is your FTP ({ftp} W).
				</p>
			{/if}
			<h2 class="eyebrow {trace ? 'mt-5' : ''}">time in zone</h2>
			{#if totalZoneSeconds > 0}
				<div class="mt-4">
					<ZoneBar seconds={zones} legend />
				</div>
			{:else}
				<p class="text-muted mt-3 text-xs">No riding recorded.</p>
			{/if}
		</section>

		<!-- Everything else, two to a row: the road's climbs, the crew's climb
		     board and the photos land here as more panels (#3141, #3147,
		     #3230), never as a new column. -->
		<div class="grid gap-4 sm:grid-cols-2 xl:col-start-2 xl:row-start-2">
			<section class="panel panel-lg">
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

			<section class="panel panel-lg">
				<div class="flex items-baseline gap-3">
					<h2 class="eyebrow">progress</h2>
					<span class="text-muted num ml-auto text-[11px]">+{xp.total} XP</span>
				</div>
				<ul class="text-muted num mt-3 space-y-1 text-[11px]">
					<li class="flex">
						<span>{kj} kJ ridden</span><span class="ml-auto">+{kj}</span>
					</li>
					<li class="flex">
						<span>execution bonus</span><span class="ml-auto"
							>+{Math.round((execution ?? 0) * 50)}</span
						>
					</li>
					{#if xp.extra > 0}
						<li class="flex">
							<span>streak bonus</span><span class="ml-auto">+{xp.extra}</span>
						</li>
					{:else if xp.extra < 0}
						<li class="flex">
							<span>over the day's XP ceiling</span><span class="ml-auto"
								>{xp.extra}</span
							>
						</li>
					{/if}
				</ul>
				<p class="text-muted mt-2 text-[11px]">
					{#if unsaved}
						None of this is on your account: the ride has not been saved.
					{:else if savedXp === undefined}
						Your own streak bonus and level land on your account with the ride —
						your weeks, not the crew's.
					{:else}
						This is the XP the ride put on your account — your streak counts
						your weeks, not the crew's.
					{/if}
				</p>
			</section>

			{#if together.length > 1}
				<!-- The moment the session ends is when who was there matters
				     (#1559): the card used to report one person's numbers. -->
				<section class="panel panel-lg">
					<h2 class="eyebrow">who rode</h2>
					<ul class="mt-3 grid gap-2">
						{#each together as rider (rider.id)}
							<li class="flex items-baseline gap-2 text-sm">
								<span class="truncate {rider.you ? 'font-medium' : ''}"
									>{rider.you ? 'You' : rider.name}</span
								>
								{#if rider.execution !== undefined}
									<span class="text-muted num ml-auto text-xs"
										>{Math.round(rider.execution * 100)}%</span
									>
								{/if}
							</li>
						{/each}
					</ul>
					{#if together.some((rider) => rider.execution !== undefined)}
						<p class="text-muted mt-2 text-[11px]">
							Execution — time on target.
						</p>
					{/if}
				</section>
			{/if}

			{#if medal}
				<section>
					<h2 class="eyebrow">your medal</h2>
					<div class="mt-3">
						<MedalCard {medal} {placeName} />
					</div>
				</section>
			{/if}
		</div>
	</div>
</article>
