<script lang="ts">
	/**
	 * The Map view (the ride HUD, 2026-11): the road from above as the ground
	 * between the rail and the Skyline, no panel. The road ahead takes the
	 * Skyline's grade ramp and is wider the steeper it is, on a bed so the
	 * ramp's pale steps read on the land under it (#4536). The road ridden is
	 * a thin muted line, you are a ring, the riders around you are ink dots
	 * with their names, each classed climb names its class at its top, and the
	 * road's end says how far there is to go. No north, no names of places, no
	 * coordinates: the shape a crew is sent (ADR-0063). One of the Wattalp
	 * map's loops is the exception: WattRoom's own land, no place of anyone's,
	 * so it is drawn on the whole map it runs through (WattalpMap.svelte), its
	 * loop on top: every loop of the map shows the same map.
	 */
	import Flag from '@lucide/svelte/icons/flag';
	import { untrack } from 'svelte';
	import type { Road } from '#lib/road/road.ts';
	import type { Route } from '#lib/road/route.ts';
	import { heightAt } from '#lib/road/at-metre.ts';
	import { planPoints, walk } from '#lib/road/draw.ts';
	import { GRADE_STROKE, gradeStep } from '#lib/road/skyline.ts';
	import { bestTurn, shapeOf, type MapView } from '#lib/ride/map-view.ts';

	let {
		view,
		mates = [],
	}: {
		view: MapView;
		/** The riders around you on this road (#4536): metres along the road as you ride it, and names. */
		mates?: { m: number; label: string }[];
	} = $props();

	// ponytail: the road in 160 even pieces, each its grade; finer if a short
	// steep ramp ever disappears in a long piece.
	// A loop of the Wattalp map, once its road is known: the line it is drawn
	// on there, loaded with the map's picture only for such a road.
	let placed = $state.raw<{
		road: Road;
		line: Route;
		reverse: boolean;
		Map: typeof import('#lib/world/WattalpMap.svelte').default;
	} | null>(null);
	$effect(() => {
		const road = view.road;
		if (untrack(() => placed?.road) === road) return;
		let gone = false;
		void import('#lib/world/wattalp.ts').then(async ({ onWattalp }) => {
			const on = onWattalp(road);
			const Map = on && (await import('#lib/world/WattalpMap.svelte')).default;
			if (!gone) placed = on && Map ? { road, ...on, Map } : null;
		});
		return () => {
			gone = true;
		};
	});
	const wattalp = $derived(placed?.road === view.road ? placed : null);
	/** Metres along the road as ridden, as metres along the map's line. */
	const onLine = (m: number) =>
		wattalp?.reverse ? wattalp.line.length - m : m;

	const PIECES = 160;
	const PAD = 28;
	let w = $state(0);
	let h = $state(0);
	const shape = $derived(shapeOf(view.road));
	const line = $derived.by(() => {
		if (w <= 0 || h <= 0 || shape.x.length < 2) return null;
		const best = bestTurn(shape.x, shape.z, w, h, PAD);
		return walk(planPoints(best.x, best.z, w, h, PAD));
	});
	const length = $derived(view.road.length || 1);
	const pieces = $derived.by(() => {
		if (!line) return [];
		const each = length / PIECES;
		return Array.from({ length: PIECES }, (_, i) => {
			const rise =
				heightAt(view.road, (i + 1) * each) - heightAt(view.road, i * each);
			return {
				a: i / PIECES,
				b: (i + 1) / PIECES,
				step: gradeStep((rise / each) * 100),
			};
		});
	});
	const at = $derived(Math.min(1, Math.max(0, view.m / length)));
	const dot = $derived(line ? line.point(at) : null);
	const tops = $derived(
		line
			? view.climbs.map((c) => ({ cls: c.cls, p: line.point(c.topM / length) }))
			: [],
	);
	const around = $derived(
		line
			? mates.map((mate) => ({
					label: mate.label,
					p: line.point(Math.min(1, Math.max(0, mate.m / length))),
				}))
			: [],
	);
	const end = $derived(line ? line.point(1) : null);
	const toGo = $derived(Math.max(0, (length - view.m) / 1000));
	const ROUND = {
		'stroke-linejoin': 'round',
		'stroke-linecap': 'round',
	} as const;
</script>

<div
	data-testid="road-map"
	class="relative h-full w-full"
	bind:clientWidth={w}
	bind:clientHeight={h}
>
	{#if wattalp}
		<wattalp.Map
			line={wattalp.line}
			m={onLine(view.m)}
			reverse={wattalp.reverse}
			mates={mates.map((mate) => ({ ...mate, m: onLine(mate.m) }))}
			you="ink"
			{toGo}
		/>
	{:else if line && dot}
		<svg
			viewBox="0 0 {w} {h}"
			width="100%"
			height="100%"
			class="block forced-color-adjust-none"
			role="img"
			aria-label="the road from above, and where you are on it: {toGo.toFixed(
				1,
			)} km to go"
		>
			<!-- The road's bed, its whole length and edged as a map's road is:
			     the road on the land. -->
			<path
				d={line.between(0, 1)}
				fill="none"
				class="stroke-muted-dim/60 forced-colors:stroke-[CanvasText]"
				stroke-width="16"
				{...ROUND}
			/>
			<path
				d={line.between(0, 1)}
				fill="none"
				class="stroke-paper forced-colors:stroke-[Canvas]"
				stroke-width="12"
				{...ROUND}
			/>
			<!-- Ridden: a thin muted line. -->
			{#if at > 0}
				<path
					d={line.between(0, at)}
					fill="none"
					class="stroke-muted-dim forced-colors:stroke-[GrayText]"
					stroke-width="3"
					{...ROUND}
				/>
			{/if}
			<!-- Ahead: each piece in its grade's step, and wider the steeper it
			     is (6 px flat, 18 px over 12 %), flat ends so no two overlap. -->
			{#each pieces as p (p.a)}
				{#if p.b > at}
					<path
						d={line.between(Math.max(p.a, at), p.b)}
						fill="none"
						class="{GRADE_STROKE[p.step]} forced-colors:stroke-[CanvasText]"
						stroke-width={6 + p.step * 3}
						stroke-linecap="butt"
						stroke-linejoin="round"
					/>
				{/if}
			{/each}
			<!-- The riders around you: ink, smaller than you, never watt. -->
			{#each around as mate, i (i)}
				<circle
					data-testid="map-mate"
					cx={mate.p[0]}
					cy={mate.p[1]}
					r="8"
					class="fill-ink stroke-surface forced-colors:fill-[CanvasText]"
					stroke-width="3"
				/>
			{/each}
			<!-- You: a ring round a dot, ink as on the climb's profile (G2). -->
			<circle
				cx={dot[0]}
				cy={dot[1]}
				r="15"
				fill="none"
				class="stroke-ink forced-colors:stroke-[Highlight]"
				stroke-width="3"
			/>
			<circle
				data-testid="map-dot"
				cx={dot[0]}
				cy={dot[1]}
				r="7"
				class="fill-ink forced-colors:fill-[Highlight]"
			/>
		</svg>
		{#each tops as top, i (i)}
			<span
				class="border-neon bg-surface text-ink absolute -translate-x-1/2 -translate-y-[160%] rounded border px-[0.4em] text-[max(16px,2.4vh)] leading-snug font-bold"
				style:left="{top.p[0]}px"
				style:top="{top.p[1]}px">{top.cls}</span
			>
		{/each}
		{#each around as mate, i (i)}
			<span
				data-testid="map-mate-label"
				class="bg-surface/85 text-ink absolute translate-x-3 -translate-y-1/2 rounded px-1.5 text-[max(15px,2vh)] leading-snug font-semibold whitespace-nowrap"
				style:left="{mate.p[0]}px"
				style:top="{mate.p[1]}px">{mate.label}</span
			>
		{/each}
		{#if end}
			<!-- The road's end, and how far there is to go to it. -->
			<span
				data-testid="map-to-go"
				class="border-frame bg-surface text-ink absolute flex -translate-x-1/2 translate-y-3 items-center gap-1 rounded border px-[0.4em] text-[max(16px,2.4vh)] leading-snug font-bold whitespace-nowrap"
				style:left="{end[0]}px"
				style:top="{end[1]}px"
				><Flag aria-hidden="true" class="size-[0.9em]" /><span class="num"
					>{toGo.toFixed(1)} km</span
				></span
			>
		{/if}
	{/if}
</div>
