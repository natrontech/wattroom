<script lang="ts">
	/**
	 * The Map view (the ride HUD, 2026-11): the road from above as the ground
	 * between the rail and the Skyline, no panel. The road ahead takes the
	 * Skyline's grade ramp and is wider the steeper it is. The road ridden is
	 * a thin muted line, you are a ring, and each classed climb names its
	 * class at its top. No north, no names, no coordinates: the shape a crew is sent
	 * (ADR-0063).
	 */
	import { heightAt } from '#lib/road/at-metre.ts';
	import { planPoints, walk } from '#lib/road/draw.ts';
	import { GRADE_STROKE, gradeStep } from '#lib/road/skyline.ts';
	import { bestTurn, shapeOf, type MapView } from '#lib/ride/map-view.ts';

	let { view }: { view: MapView } = $props();

	// ponytail: the road in 160 even pieces, each its grade; finer if a short
	// steep ramp ever disappears in a long piece.
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
	{#if line && dot}
		<svg
			viewBox="0 0 {w} {h}"
			width="100%"
			height="100%"
			class="block forced-color-adjust-none"
			role="img"
			aria-label="the road from above, and where you are on it"
		>
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
	{/if}
</div>
