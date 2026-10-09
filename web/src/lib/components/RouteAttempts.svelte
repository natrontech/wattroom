<script lang="ts">
	import { page } from '$app/state';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { formatClockLong, formatKm, formatShortDate } from '$lib/format';
	import { withBack } from '$lib/back-link';
	import {
		attemptPoints,
		attemptTrend,
		bestAndLast,
		type Attempt,
		type ClimbBest,
	} from '$lib/road/attempts';

	/**
	 * Every ride of a route, as its owner sees them (#3615, #3033): the best
	 * and the last, each a link to its ride (#3680); then each at its average
	 * speed by date — a timed ride solid, a ride together or in ERG hollow —
	 * and the trend through the timed ones. History, not live data: nothing
	 * here glows (ADR-0005), and shape carries what a ride was, never colour
	 * alone. The page reads the attempts once; the climbs table and the
	 * carry-on read them too.
	 */
	let {
		data,
		error,
		onretry,
	}: {
		data: { attempts: Attempt[]; climbBests: ClimbBest[] } | null;
		error: string | null;
		onretry: () => void;
	} = $props();

	const lines = $derived.by(() => {
		const { best, last } = bestAndLast(data?.attempts ?? []);
		return [
			{ label: 'Best', ride: best },
			{ label: 'Last', ride: last },
		].filter((l): l is { label: string; ride: Attempt } => !!l.ride);
	});
	const speed = (a: Attempt) =>
		a.distanceM && a.seconds > 0
			? ` · ${formatKm(a.distanceM)} km at ${((a.distanceM / a.seconds) * 3.6).toFixed(1)} km/h`
			: '';

	const points = $derived(data ? attemptPoints(data.attempts) : []);
	const trend = $derived(attemptTrend(points));

	let width = $state(600);
	const W = $derived(Math.max(width, 240));
	const H = 160;
	const PAD = { top: 12, bottom: 24, right: 64, left: 8 };
	const plotW = $derived(W - PAD.left - PAD.right);
	const plotH = H - PAD.top - PAD.bottom;

	const span = $derived.by(() => {
		const first = points[0]?.at ?? 0;
		const last = points[points.length - 1]?.at ?? 0;
		return { first, len: last - first };
	});
	const domain = $derived.by(() => {
		const speeds = points.map((p) => p.kmh);
		const lo = Math.min(...speeds);
		const hi = Math.max(...speeds);
		const margin = Math.max((hi - lo) * 0.15, 1);
		return { lo: Math.max(lo - margin, 0), hi: hi + margin };
	});
	// One ride, or all on one day, sits in the middle rather than on an edge.
	const x = (at: number) =>
		PAD.left +
		(span.len > 0 ? ((at - span.first) / span.len) * plotW : plotW / 2);
	const y = (kmh: number) =>
		PAD.top + plotH - ((kmh - domain.lo) / (domain.hi - domain.lo)) * plotH;
</script>

<section aria-labelledby="route-attempts">
	<h2 id="route-attempts" class="eyebrow">Your rides</h2>
	{#if error}
		<div class="mt-2">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={onretry} class="btn-link text-xs">Retry</button>
				{/snippet}
			</Banner>
		</div>
	{:else if data === null}
		<Skeleton class="mt-2 h-40" />
	{:else if data.attempts.length === 0}
		<p class="text-muted mt-2 text-sm">
			Ride it once and your best and last rides of this road land here.
		</p>
	{:else}
		<ul class="divide-frame mt-2 divide-y text-sm">
			{#each lines as l (l.label)}
				<li>
					<a
						href={withBack(
							`/history/${l.ride.rideId}`,
							page.url.pathname + page.url.search,
						)}
						class="flex flex-wrap items-baseline gap-x-3 py-2 hover:underline"
					>
						<span class="eyebrow w-10">{l.label}</span>
						<span class="font-display tabular-nums"
							>{formatClockLong(l.ride.seconds)}{speed(l.ride)}</span
						>
						<span class="text-muted ml-auto flex items-center gap-1 text-xs"
							>{formatShortDate(Date.parse(l.ride.startedAt))}<ChevronRight
								size={14}
							/></span
						>
					</a>
				</li>
			{/each}
		</ul>
		{#if points.length === 0}
			<p class="text-muted mt-1 text-xs leading-relaxed">
				Your rides of this road were saved before their distance was kept, so
				there is no speed to draw yet. The next one starts the chart.
			</p>
		{:else}
			<div
				class="text-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
				role="list"
				aria-label="legend"
			>
				<span class="flex items-center gap-1" role="listitem">
					<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
						><circle cx="5" cy="5" r="4" class="fill-ink" /></svg
					>
					timed
				</span>
				<span class="flex items-center gap-1" role="listitem">
					<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
						><circle
							cx="5"
							cy="5"
							r="3.5"
							fill="none"
							class="stroke-ink"
							stroke-width="1.5"
						/></svg
					>
					together or ERG
				</span>
				{#if trend}
					<span class="flex items-center gap-1" role="listitem">
						<svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"
							><line
								x1="0"
								x2="16"
								y1="5"
								y2="5"
								class="stroke-neon"
								stroke-width="2"
								stroke-dasharray="4 3"
							/></svg
						>
						trend of the timed rides
					</span>
				{/if}
			</div>
			<div class="mt-2 w-full" bind:clientWidth={width}>
				<svg
					viewBox="0 0 {W} {H}"
					width="100%"
					height={H}
					class="block"
					role="img"
					aria-label="Your average speed on each ride of this road, by date"
				>
					{#each [domain.lo, domain.hi] as kmh (kmh)}
						<line
							x1={PAD.left}
							x2={PAD.left + plotW}
							y1={y(kmh)}
							y2={y(kmh)}
							stroke-width="1"
							class="stroke-neon/20"
						/>
						<text
							x={PAD.left + plotW + 8}
							y={y(kmh) + 4}
							class="fill-muted font-display text-[12px]"
							>{kmh.toFixed(1)} km/h</text
						>
					{/each}
					<text
						x={PAD.left}
						y={H - 6}
						class="fill-muted font-display text-[12px]"
						>{formatShortDate(span.first)}</text
					>
					{#if span.len > 0}
						<text
							x={PAD.left + plotW}
							y={H - 6}
							text-anchor="end"
							class="fill-muted font-display text-[12px]"
							>{formatShortDate(span.first + span.len)}</text
						>
					{/if}
					{#if trend}
						<line
							x1={x(trend.from.at)}
							x2={x(trend.to.at)}
							y1={y(trend.from.kmh)}
							y2={y(trend.to.kmh)}
							class="stroke-neon"
							stroke-width="2"
							stroke-dasharray="6 4"
						/>
					{/if}
					{#each points as p (p.rideId)}
						{#if p.solid}
							<circle cx={x(p.at)} cy={y(p.kmh)} r="4" class="fill-ink" />
						{:else}
							<circle
								cx={x(p.at)}
								cy={y(p.kmh)}
								r="3.5"
								fill="none"
								class="stroke-ink"
								stroke-width="1.5"
							/>
						{/if}
					{/each}
				</svg>
			</div>
		{/if}
	{/if}
</section>
