<script lang="ts">
	import type { Climb } from '$lib/road/climbs';
	import { kmTicks, planPoints, walk } from '$lib/road/draw';
	import { isLoop } from '$lib/road/line';
	import { gradeStep } from '$lib/road/skyline';

	/**
	 * A route from above, north up, in a fixed-height panel (#3679): the
	 * owner's shape, drawn in their own browser and shown to nobody else
	 * (ADR-0063). No tiles, so the page's img-src stays as it is; #3138 lays
	 * them under it. The panel is measured and the drawing sized to it, so a
	 * marker or a tick reads the same at any width.
	 */
	let {
		x,
		z,
		climbs = [],
		length,
		note,
	}: {
		x?: ArrayLike<number>;
		z?: ArrayLike<number>;
		/** Classed climbs are overpainted in their grade-ramp step. */
		climbs?: Climb[];
		/** The road's metres, so a climb's and a tick's land on the shape. */
		length?: number;
		/** Why there is no shape (a route that kept only its heights), said in the panel. */
		note?: string;
	} = $props();

	// The ramp's strokes, spelled out for Tailwind (GRADE_FILL's order).
	const STROKE = [
		'stroke-grade-1',
		'stroke-grade-2',
		'stroke-grade-3',
		'stroke-grade-4',
		'stroke-grade-5',
	];
	const PAD = 12;

	let w = $state(0);
	let h = $state(0);
	const shaped = $derived(!!x && !!z && x.length > 1);
	const points = $derived(shaped && w > 0 ? planPoints(x!, z!, w, h, PAD) : []);
	const line = $derived(points.length ? walk(points) : null);
	const loop = $derived(
		shaped &&
			isLoop({ x: Array.from(x!), z: Array.from(z!), e: [] as number[] }),
	);
	const span = $derived(length ?? 0);
	const overpaint = $derived(
		line && span
			? climbs
					.filter((c) => c.cls)
					.map((c) => ({
						d: line.between(c.startM / span, c.topM / span),
						step: gradeStep((c.gainM / (c.topM - c.startM || 1)) * 100),
					}))
			: [],
	);
	const ticks = $derived(
		line && span
			? kmTicks(span).map((km) => ({
					km,
					at: line.point((km * 1000) / span),
				}))
			: [],
	);
</script>

<figure class="panel panel-flush relative h-[220px] sm:h-[280px]">
	{#if shaped}
		<div
			class="absolute inset-x-4 top-4 bottom-9"
			bind:clientWidth={w}
			bind:clientHeight={h}
		>
			{#if line}
				<svg
					viewBox="0 0 {w} {h}"
					width="100%"
					height="100%"
					class="block"
					role="img"
					aria-label="Your route from above, north up"
				>
					<path
						d={line.between(0, 1)}
						fill="none"
						class="stroke-neon"
						stroke-width="3"
						stroke-linejoin="round"
						stroke-linecap="round"
					/>
					{#each overpaint as c, i (i)}
						<path
							d={c.d}
							fill="none"
							class={STROKE[c.step]}
							stroke-width="3"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>
					{/each}
					{#each ticks as t (t.km)}
						<circle
							cx={t.at[0]}
							cy={t.at[1]}
							r="9"
							class="fill-surface-raised stroke-neon"
							stroke-width="1"
						/>
						<text
							x={t.at[0]}
							y={t.at[1]}
							text-anchor="middle"
							dominant-baseline="central"
							class="fill-ink font-display text-[9px] font-bold">{t.km}</text
						>
					{/each}
					{#if !loop}
						<!-- The finish, a ring; a loop's ends are one place, one marker. -->
						<circle
							cx={points[points.length - 1][0]}
							cy={points[points.length - 1][1]}
							r="5"
							class="fill-surface-raised stroke-neon"
							stroke-width="2"
						/>
					{/if}
					<circle cx={points[0][0]} cy={points[0][1]} r="5" class="fill-neon" />
				</svg>
			{/if}
		</div>
		<figcaption class="text-muted absolute bottom-3 left-4 text-xs">
			Only you see this map
		</figcaption>
	{:else}
		<figcaption
			class="text-muted grid h-full place-items-center px-6 text-center text-sm"
		>
			{note ?? ''}
		</figcaption>
	{/if}
</figure>
