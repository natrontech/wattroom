<script lang="ts">
	// Best-effort power per SPEC curve window, three recency ranges (#222).
	// Recency is ordered (30 d ⊂ 90 d ⊂ all-time), so the series are one hue
	// at three opacity steps — sequential, not categorical, and readable for
	// every kind of color vision by lightness alone.
	interface Curve {
		best5s: number;
		best1m: number;
		best5m: number;
		best20m: number;
	}
	let { d30, d90, all }: { d30: Curve; d90: Curve; all: Curve } = $props();

	const WINDOWS = [
		{ key: 'best5s', label: '5 s' },
		{ key: 'best1m', label: '1 min' },
		{ key: 'best5m', label: '5 min' },
		{ key: 'best20m', label: '20 min' },
	] as const;
	const RANGES = [
		{ curve: () => all, label: 'all time', opacity: 0.28 },
		{ curve: () => d90, label: '90 days', opacity: 0.55 },
		{ curve: () => d30, label: '30 days', opacity: 1 },
	];

	const W = 600;
	const H = 190;
	const PAD = { top: 22, bottom: 22 };
	const plotH = H - PAD.top - PAD.bottom;
	const groupW = W / WINDOWS.length;
	const barW = 34;
	const gap = 2; // surface gap between adjacent bars

	const max = $derived(
		Math.max(
			1,
			...WINDOWS.flatMap((w) => [d30[w.key], d90[w.key], all[w.key]]),
		),
	);
	const barH = (watts: number) => (watts / max) * plotH;
</script>

<div class="flex items-center gap-4 text-xs" role="list" aria-label="legend">
	{#each RANGES as range (range.label)}
		<span class="text-muted flex items-center gap-1.5" role="listitem">
			<span
				class="bg-z2 inline-block h-2.5 w-2.5 rounded-xs"
				style="opacity: {range.opacity}"
			></span>
			{range.label}
		</span>
	{/each}
</div>

<svg
	viewBox="0 0 {W} {H}"
	class="mt-2 w-full"
	role="img"
	aria-label="Best power by duration, 30 days vs 90 days vs all time"
>
	{#each [0.5, 1] as frac (frac)}
		<line
			x1="0"
			x2={W}
			y1={H - PAD.bottom - plotH * frac}
			y2={H - PAD.bottom - plotH * frac}
			stroke="currentColor"
			stroke-width="1"
			class="text-muted opacity-20"
			vector-effect="non-scaling-stroke"
		/>
		<text
			x="0"
			y={H - PAD.bottom - plotH * frac - 4}
			class="fill-muted font-display text-[11px] opacity-60"
			>{Math.round(max * frac)} W</text
		>
	{/each}
	{#each WINDOWS as win, wi (win.key)}
		{@const cx = wi * groupW + groupW / 2}
		{#each RANGES as range, ri (range.label)}
			{@const watts = range.curve()[win.key]}
			{@const x = cx + (ri - 1) * (barW + gap) - barW / 2}
			<rect
				{x}
				y={H - PAD.bottom - barH(watts)}
				width={barW}
				height={Math.max(barH(watts), watts > 0 ? 2 : 0)}
				rx="4"
				class="fill-z2"
				style="opacity: {range.opacity}"
			>
				<title>{range.label} · best {win.label}: {watts} W</title>
			</rect>
		{/each}
		<!-- Direct label on the current-capability bar only — selective, not a
		     number on every mark. -->
		{#if d30[win.key] > 0}
			<text
				x={cx + barW + gap}
				y={H - PAD.bottom - barH(d30[win.key]) - 5}
				text-anchor="middle"
				class="fill-ink font-display text-[12px] font-semibold"
				>{d30[win.key]}</text
			>
		{/if}
		<text
			x={cx}
			y={H - 6}
			text-anchor="middle"
			class="fill-muted font-display text-[11px]">{win.label}</text
		>
	{/each}
	<line
		x1="0"
		x2={W}
		y1={H - PAD.bottom}
		y2={H - PAD.bottom}
		stroke="currentColor"
		stroke-width="1"
		class="text-muted opacity-40"
		vector-effect="non-scaling-stroke"
	/>
</svg>
