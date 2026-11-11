<script lang="ts">
	/**
	 * A road ride's panel on the closing card (#4516): the road as you rode
	 * it — the profile the ride's page draws (#3639), your zones along it —
	 * the stretch in numbers, and the classed climbs you went up. From your
	 * own seconds' metres and heights, never a map: the route's sealed map
	 * stays behind its owner's own open (ADR-0063), and nothing here is kept.
	 */
	import { Trophy } from '@lucide/svelte';
	import { ZONE_VAR } from '#lib/components/zones.ts';
	import { formatClock, formatKm } from '#lib/format.ts';
	import { climbsOf } from '#lib/road/climbs.ts';
	import { chipsIn, GRADE_FILL, tileOf } from '#lib/road/skyline.ts';
	import { wholeRoadFrame } from './ride-profile';
	import type { RoadRecap } from './road-recap';

	let { recap }: { recap: RoadRecap } = $props();

	// A viewBox, never a pixel width on an SVG the page measures (ux.md).
	const W = 1000;
	const H = 120;
	const drawn = $derived.by(() => {
		const frame = wholeRoadFrame(recap.profile, W, H);
		return {
			tile: tileOf(frame, recap.profile, 0),
			chips: chipsIn(frame, recap.profile, climbsOf(recap.profile)),
		};
	});
	const column = $derived(W / Math.max(1, recap.zones.length));
	const timed = $derived(recap.climbs.some((c) => c.seconds !== undefined));
</script>

<section
	class="panel panel-lg sm:col-span-2"
	aria-label="the road you rode"
	data-testid="recap-road"
>
	<div class="flex items-baseline gap-3">
		<h2 class="eyebrow">the road</h2>
		<span class="text-muted num ml-auto text-[11px]">{recap.stretch}</span>
	</div>
	<div
		class="relative mt-4 h-28"
		role="img"
		aria-label="the road's profile as you rode it, {recap.stretch}"
	>
		<svg
			viewBox="0 0 {W} {H}"
			width="100%"
			height="100%"
			preserveAspectRatio="none"
			class="forced-color-adjust-none"
			aria-hidden="true"
		>
			{#each drawn.tile.areas as area, step (step)}
				{#if area}<path
						d={area}
						class="{GRADE_FILL[step]} forced-colors:fill-[GrayText]"
					/>{/if}
			{/each}
			<path
				d={drawn.tile.line}
				fill="none"
				class="stroke-neon forced-colors:stroke-[CanvasText]"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
			/>
		</svg>
		{#each drawn.chips as chip, i (i)}
			<span
				class="border-neon bg-surface text-ink absolute -mt-1 -translate-x-1/2 -translate-y-full rounded border px-1 text-sm leading-none font-bold"
				style:left="{(chip.x / W) * 100}%"
				style:top="{(chip.y / H) * 100}%">{chip.cls}</span
			>
		{/each}
	</div>
	<!-- Your zones along it: the trace's colours, laid on the metres they
	     were ridden over rather than the seconds. -->
	<svg
		viewBox="0 0 {W} 6"
		width="100%"
		height="6"
		preserveAspectRatio="none"
		class="mt-1 block"
		aria-hidden="true"
	>
		{#each recap.zones as zone, i (i)}
			{#if zone > 0}
				<rect
					x={i * column}
					y="0"
					width={column + 0.5}
					height="6"
					fill={ZONE_VAR[zone]}
				/>
			{/if}
		{/each}
	</svg>
	<p class="text-muted mt-1 text-[11px]">
		The road as you rode it, with the zone you rode each stretch in.
	</p>

	{#if recap.climbs.length > 0}
		<h3 class="eyebrow mt-4">climbs</h3>
		<ul class="mt-2 grid gap-1.5">
			{#each recap.climbs as climb (climb.startM)}
				<li class="flex items-baseline gap-2 text-sm">
					<span
						class="border-neon w-8 shrink-0 rounded border text-center text-xs leading-5 font-bold"
						>{climb.cls}</span
					>
					<span class="text-muted num text-xs"
						>{formatKm(climb.topM - climb.startM)} km · {Math.round(
							climb.gainM,
						)} m</span
					>
					{#if climb.pr}
						<span
							class="text-neon inline-flex items-center gap-1 text-xs font-medium"
							><Trophy class="size-3.5" aria-hidden="true" />PR</span
						>
					{/if}
					{#if climb.seconds !== undefined}
						<span class="font-display ml-auto tabular-nums"
							>{formatClock(climb.seconds)}</span
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if !timed}
			<p class="text-muted mt-2 text-[11px]">
				No climb times on this ride: a time is yours when your own watts moved
				you up the road.
			</p>
		{/if}
	{/if}
</section>
