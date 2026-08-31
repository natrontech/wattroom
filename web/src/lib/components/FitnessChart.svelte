<script lang="ts">
	// Fitness/Fatigue over the load series (#222, ADR-0016). Drawn 1:1 in
	// container pixels (bind:clientWidth) so type never scales down — the
	// grid is the synthwave horizon (neon = grids, ADR-0005). Identity is
	// carried by weight and shape, never color alone. Hover for a day's
	// numbers; click a day to jump to its rides.
	import ChartTip from '$lib/components/ChartTip.svelte';
	import type { FormPoint } from '$lib/progression';

	let {
		series,
		onpick,
	}: { series: FormPoint[]; onpick?: (date: string) => void } = $props();

	let width = $state(600);
	const W = $derived(Math.max(width, 320));
	const H = 280;
	const PAD = { top: 18, bottom: 28, right: 52 };
	const plotW = $derived(W - PAD.right);
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
	const area = $derived(
		`${path((p) => p.fitness)} L ${plotW.toFixed(1)} ${H - PAD.bottom} L 0 ${H - PAD.bottom} Z`,
	);

	let hovered = $state<number | null>(null);
	function toIndex(event: PointerEvent) {
		const svg = event.currentTarget as SVGSVGElement;
		const view = (event.offsetX / svg.clientWidth) * W;
		return Math.min(
			series.length - 1,
			Math.max(0, Math.round((view / plotW) * (series.length - 1))),
		);
	}

	const dayLabel = (d: string) =>
		new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
		});
</script>

<div class="flex items-center gap-4 text-xs" role="list" aria-label="legend">
	<span class="text-muted flex items-center gap-1.5" role="listitem">
		<span class="bg-ink inline-block h-1 w-4"></span>
		fitness
	</span>
	<span class="text-muted flex items-center gap-1.5" role="listitem">
		<span class="bg-z2 inline-block h-0.5 w-4"></span>
		fatigue
	</span>
	<span class="text-muted ml-auto hidden text-[11px] sm:block"
		>click a day to see its rides</span
	>
</div>

<div class="mt-3 w-full" bind:clientWidth={width}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<svg
		viewBox="0 0 {W} {H}"
		width={W}
		height={H}
		class="block {onpick ? 'cursor-pointer' : ''}"
		role="img"
		aria-label="Fitness and fatigue over the last months"
		onpointermove={(e) => (hovered = toIndex(e))}
		onpointerleave={() => (hovered = null)}
		onclick={(e) =>
			onpick?.(series[toIndex(e as unknown as PointerEvent)].date)}
	>
		<!-- The horizon grid: structural, so it takes neon (ADR-0005). -->
		{#each [0.25, 0.5, 0.75, 1] as frac (frac)}
			{@const v = (max / 1.15) * frac}
			<line
				x1="0"
				x2={plotW}
				y1={y(v)}
				y2={y(v)}
				stroke="currentColor"
				stroke-width="1"
				class="text-neon opacity-20"
			/>
			<text
				x={plotW + 8}
				y={y(v) + 4}
				class="fill-muted font-display text-[12px]">{Math.round(v)}</text
			>
		{/each}
		<line
			x1="0"
			x2={plotW}
			y1={H - PAD.bottom}
			y2={H - PAD.bottom}
			stroke="currentColor"
			stroke-width="1.5"
			class="text-neon opacity-40"
		/>
		<defs>
			<linearGradient id="fitness-fill" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="currentColor" stop-opacity="0.14" />
				<stop offset="1" stop-color="currentColor" stop-opacity="0" />
			</linearGradient>
		</defs>
		<path d={area} fill="url(#fitness-fill)" class="text-ink" />
		<path
			d={path((p) => p.fatigue)}
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			class="text-z2"
		/>
		<path
			d={path((p) => p.fitness)}
			fill="none"
			stroke="currentColor"
			stroke-width="3"
			stroke-linejoin="round"
			class="text-ink"
		/>
		<text x="0" y={H - 8} class="fill-muted font-display text-[12px]"
			>{dayLabel(series[0].date)}</text
		>
		<text
			x={plotW}
			y={H - 8}
			text-anchor="end"
			class="fill-muted font-display text-[12px]"
			>{dayLabel(series[series.length - 1].date)}</text
		>
		{#if hovered !== null}
			{@const p = series[hovered]}
			<line
				x1={x(hovered)}
				x2={x(hovered)}
				y1={PAD.top}
				y2={H - PAD.bottom}
				stroke="currentColor"
				stroke-width="1"
				class="text-muted opacity-60"
			/>
			<circle cx={x(hovered)} cy={y(p.fitness)} r="5" class="fill-ink" />
			<circle cx={x(hovered)} cy={y(p.fatigue)} r="4.5" class="fill-z2" />
			<ChartTip
				x={x(hovered)}
				y={Math.min(y(p.fitness), y(p.fatigue))}
				maxX={W}
				lines={[
					dayLabel(p.date),
					`fitness ${Math.round(p.fitness)} · fatigue ${Math.round(p.fatigue)}`,
					`form ${p.form > 0 ? '+' : ''}${Math.round(p.form)}`,
				]}
			/>
		{/if}
	</svg>
</div>
