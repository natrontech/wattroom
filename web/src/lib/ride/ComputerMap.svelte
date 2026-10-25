<script lang="ts">
	/**
	 * The MAP page (#3645): the road from above as its turns draw it, with
	 * your dot on it. Classed climbs are overpainted in the grade ramp, never
	 * the zone tokens (#397). The dot is ink, as on the CLIMB page: watt marks
	 * your place once, on the Skyline (TARGETS G2). No north, no names, no
	 * coordinates: the shape a crew is sent (ADR-0063).
	 */
	import { bestTurn, shapeOf, type MapView } from '$lib/ride/map-view';
	import { planPoints, walk } from '$lib/road/draw';
	import { GRADE_STROKE, gradeStep } from '$lib/road/skyline';

	let { view, tv = false }: { view: MapView; tv?: boolean } = $props();

	const PAD = 4;
	let w = $state(0);
	let h = $state(0);
	const shape = $derived(shapeOf(view.road));
	// The drawing fills the panel (G3): the shape has no north, so it is
	// turned to the angle where its aspect-kept fit is largest. A straight
	// road runs corner to corner rather than as a hairline with bands round it.
	const line = $derived.by(() => {
		if (w <= 0 || h <= 0 || shape.x.length < 2) return null;
		const best = bestTurn(shape.x, shape.z, w, h, PAD);
		return walk(planPoints(best.x, best.z, w, h, PAD));
	});
	const length = $derived(view.road.length || 1);
	const climbs = $derived(
		line
			? view.climbs.map((c) => ({
					d: line.between(c.startM / length, c.topM / length),
					step: gradeStep((c.gainM / (c.topM - c.startM || 1)) * 100),
				}))
			: [],
	);
	const dot = $derived(line ? line.point(view.m / length) : null);
</script>

<div
	data-testid="computer-map"
	class="relative -my-3 {tv ? 'min-h-[22vh] flex-1' : 'min-h-38 flex-1'}"
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
			<path
				d={line.between(0, 1)}
				fill="none"
				class="stroke-muted-dim forced-colors:stroke-[CanvasText]"
				stroke-width="3"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
			{#each climbs as c, i (i)}
				<path
					d={c.d}
					fill="none"
					class="stroke-surface-raised"
					stroke-width="3"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
				<path
					d={c.d}
					fill="none"
					class="{GRADE_STROKE[c.step]} forced-colors:stroke-[GrayText]"
					stroke-width="3"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			{/each}
			<circle
				data-testid="map-dot"
				cx={dot[0]}
				cy={dot[1]}
				r="6"
				class="fill-ink stroke-surface forced-colors:fill-[Highlight]"
				stroke-width="2"
			/>
		</svg>
	{/if}
</div>
