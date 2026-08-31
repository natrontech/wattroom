<script lang="ts">
	// Fitness/Fatigue over the load series (#222, ADR-0014). Two lines with a
	// legend; identity is also carried by weight (fitness is the heavy ink
	// line), never color alone. Hover any day for its numbers.
	import type { FormPoint } from '$lib/progression';

	let { series }: { series: FormPoint[] } = $props();

	const W = 600;
	const H = 190;
	const PAD = { top: 14, bottom: 22, right: 44 };
	const plotW = W - PAD.right;
	const plotH = H - PAD.top - PAD.bottom;

	const x = (i: number) =>
		series.length > 1 ? (i / (series.length - 1)) * plotW : 0;
	const max = $derived(
		Math.max(1, ...series.flatMap((p) => [p.fitness, p.fatigue])) * 1.15,
	);
	const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

	const path = (pick: (p: FormPoint) => number) =>
		series
			.map(
				(p, i) =>
					`${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(pick(p)).toFixed(1)}`,
			)
			.join(' ');

	const dayLabel = (d: string) =>
		new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
		});
</script>

<div class="flex items-center gap-4 text-xs" role="list" aria-label="legend">
	<span class="text-muted flex items-center gap-1.5" role="listitem">
		<span class="bg-ink inline-block h-1 w-3.5"></span>
		fitness
	</span>
	<span class="text-muted flex items-center gap-1.5" role="listitem">
		<span class="bg-z2 inline-block h-0.5 w-3.5"></span>
		fatigue
	</span>
</div>

<svg
	viewBox="0 0 {W} {H}"
	class="mt-2 w-full"
	role="img"
	aria-label="Fitness and fatigue over the last months"
>
	{#each [0.5, 1] as frac (frac)}
		{@const v = (max / 1.15) * frac}
		<line
			x1="0"
			x2={plotW}
			y1={y(v)}
			y2={y(v)}
			stroke="currentColor"
			stroke-width="1"
			class="text-muted opacity-20"
			vector-effect="non-scaling-stroke"
		/>
		<text
			x={plotW + 6}
			y={y(v) + 4}
			class="fill-muted font-display text-[11px] opacity-60"
			>{Math.round(v)}</text
		>
	{/each}
	<path
		d={path((p) => p.fatigue)}
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		class="text-z2"
		vector-effect="non-scaling-stroke"
	/>
	<path
		d={path((p) => p.fitness)}
		fill="none"
		stroke="currentColor"
		stroke-width="3"
		class="text-ink"
		vector-effect="non-scaling-stroke"
	/>
	{#each series as point, i (point.date)}
		<rect
			x={x(i) - plotW / series.length / 2}
			y="0"
			width={plotW / series.length}
			height={H}
			fill="transparent"
		>
			<title
				>{dayLabel(point.date)} · fitness {Math.round(point.fitness)} · fatigue
				{Math.round(point.fatigue)}</title
			>
		</rect>
	{/each}
	<text x="0" y={H - 6} class="fill-muted font-display text-[11px]"
		>{dayLabel(series[0].date)}</text
	>
	<text
		x={plotW}
		y={H - 6}
		text-anchor="end"
		class="fill-muted font-display text-[11px]"
		>{dayLabel(series[series.length - 1].date)}</text
	>
</svg>
