<script lang="ts">
	// Best-effort power per SPEC curve window, three recency ranges (#222).
	// Recency is ordered (30 d ⊂ 90 d ⊂ all-time), so the series are one hue
	// at three opacity steps — sequential, not categorical, and readable for
	// every kind of color vision by lightness alone. Drawn 1:1 in container
	// pixels; neon grid per ADR-0005.
	import ChartTip from '$lib/components/ChartTip.svelte';

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
		{ curve: () => all, label: 'all time', opacity: 0.25 },
		{ curve: () => d90, label: '90 days', opacity: 0.55 },
		{ curve: () => d30, label: '30 days', opacity: 1 },
	];

	let width = $state(600);
	const W = $derived(Math.max(width, 320));
	const H = 260;
	const PAD = { top: 30, bottom: 30 };
	const plotH = H - PAD.top - PAD.bottom;
	const groupW = $derived(W / WINDOWS.length);
	const barW = $derived(Math.min(52, Math.max(26, groupW / 4.2)));
	const gap = 3; // surface gap between adjacent bars

	const max = $derived(
		Math.max(
			1,
			...WINDOWS.flatMap((w) => [d30[w.key], d90[w.key], all[w.key]]),
		),
	);
	const barH = (watts: number) => (watts / max) * plotH;

	let hovered = $state<{ wi: number; ri: number } | null>(null);
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

<div class="mt-3 w-full" bind:clientWidth={width}>
	<svg
		viewBox="0 0 {W} {H}"
		width={W}
		height={H}
		class="block"
		role="img"
		aria-label="Best power by duration, 30 days vs 90 days vs all time"
	>
		<!-- One mid gridline only: the top line collides with the direct labels
		     and the bars carry their own numbers anyway. -->
		<line
			x1="0"
			x2={W}
			y1={H - PAD.bottom - plotH * 0.5}
			y2={H - PAD.bottom - plotH * 0.5}
			stroke="currentColor"
			stroke-width="1"
			class="text-neon opacity-20"
		/>
		<text
			x="0"
			y={H - PAD.bottom - plotH * 0.5 - 6}
			class="fill-muted font-display text-[12px]"
			>{Math.round(max * 0.5)} W</text
		>
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
					rx="5"
					class="fill-z2"
					style="opacity: {hovered?.wi === wi && hovered?.ri === ri
						? 1
						: range.opacity}"
					role="presentation"
					onpointerenter={() => (hovered = { wi, ri })}
					onpointerleave={() => (hovered = null)}
				/>
			{/each}
			<!-- Direct label on the current-capability bar only — selective, not a
			     number on every mark. -->
			{#if d30[win.key] > 0}
				<text
					x={cx + barW + gap}
					y={H - PAD.bottom - barH(d30[win.key]) - 8}
					text-anchor="middle"
					class="fill-ink font-display text-[15px] font-semibold"
					>{d30[win.key]}</text
				>
			{/if}
			<text
				x={cx}
				y={H - 8}
				text-anchor="middle"
				class="fill-muted font-display text-[13px]">{win.label}</text
			>
		{/each}
		<line
			x1="0"
			x2={W}
			y1={H - PAD.bottom}
			y2={H - PAD.bottom}
			stroke="currentColor"
			stroke-width="1.5"
			class="text-neon opacity-40"
		/>
		{#if hovered}
			{@const win = WINDOWS[hovered.wi]}
			{@const range = RANGES[hovered.ri]}
			{@const watts = range.curve()[win.key]}
			{@const cx = hovered.wi * groupW + groupW / 2}
			<ChartTip
				x={cx + (hovered.ri - 1) * (barW + gap)}
				y={H - PAD.bottom - barH(watts)}
				maxX={W}
				lines={[`best ${win.label} · ${range.label}`, `${watts} W`]}
			/>
		{/if}
	</svg>
</div>
