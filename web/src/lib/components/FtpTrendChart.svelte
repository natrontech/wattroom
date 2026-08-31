<script lang="ts">
	// FTP over time as a step line (captured at ride time — history, not
	// reconstruction), each ride's best 20-min effort as a dot (#222). Drawn
	// 1:1 in container pixels so type never scales down; neon grid per
	// ADR-0005. Identity is carried by shape (line vs dot) plus the legend,
	// never color alone. Hover for a ride's numbers; click to jump to it.
	import ChartTip from '$lib/components/ChartTip.svelte';
	import type { TrendRide } from '$lib/progression';

	let {
		rides,
		onpick,
		height = 240,
	}: {
		rides: TrendRide[];
		onpick?: (ride: TrendRide) => void;
		height?: number;
	} = $props();

	let width = $state(600);
	const W = $derived(Math.max(width, 280));
	const H = $derived(height);
	const PAD = { top: 18, bottom: 28, right: 56 };
	const plotW = $derived(W - PAD.right);
	const plotH = $derived(H - PAD.top - PAD.bottom);

	const t = (d: string) => new Date(d).getTime();
	const span = $derived.by(() => {
		const first = t(rides[0].date);
		const last = t(rides[rides.length - 1].date);
		return { first, len: Math.max(last - first, 1) };
	});
	const x = (d: string) => ((t(d) - span.first) / span.len) * plotW;

	const domain = $derived.by(() => {
		const watts = rides.flatMap((r) => [r.ftp, r.best20m]).filter((w) => w > 0);
		const lo = Math.min(...watts);
		const hi = Math.max(...watts);
		const margin = Math.max((hi - lo) * 0.15, 10);
		return { lo: Math.max(lo - margin, 0), hi: hi + margin };
	});
	const y = (watts: number) =>
		PAD.top + plotH - ((watts - domain.lo) / (domain.hi - domain.lo)) * plotH;

	// Step line: FTP holds its value until the ride where it changed.
	const ftpPath = $derived(
		rides
			.map((r, i) => {
				const px = x(r.date).toFixed(1);
				const py = y(r.ftp).toFixed(1);
				if (i === 0) return `M ${px} ${py}`;
				return `H ${px} V ${py}`;
			})
			.join(' '),
	);

	let hovered = $state<TrendRide | null>(null);
	function nearest(event: PointerEvent) {
		const svg = event.currentTarget as SVGSVGElement;
		const view = (event.offsetX / svg.clientWidth) * W;
		let best: TrendRide | null = null;
		let dist = Infinity;
		for (const ride of rides) {
			const d = Math.abs(x(ride.date) - view);
			if (d < dist) {
				dist = d;
				best = ride;
			}
		}
		return best;
	}

	const monthLabel = (d: string) =>
		new Date(d).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
		});
</script>

<div class="flex items-center gap-4 text-xs" role="list" aria-label="legend">
	<span class="text-muted flex items-center gap-1.5" role="listitem">
		<span class="bg-ink inline-block h-0.5 w-4"></span>
		FTP
	</span>
	<span class="text-muted flex items-center gap-1.5" role="listitem">
		<span class="bg-z2 inline-block h-2.5 w-2.5 rounded-full"></span>
		best 20 min of a ride
	</span>
</div>

<div class="mt-3 w-full" bind:clientWidth={width}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<svg
		viewBox="0 0 {W} {H}"
		width={W}
		height={H}
		class="block {onpick ? 'cursor-pointer' : ''}"
		role="img"
		aria-label="FTP and 20-minute bests over time"
		onpointermove={(e) => (hovered = nearest(e))}
		onpointerleave={() => (hovered = null)}
		onclick={(e) => {
			const ride = nearest(e as unknown as PointerEvent);
			if (ride) onpick?.(ride);
		}}
	>
		{#each [0.25, 0.5, 0.75, 1] as frac (frac)}
			{@const watts = domain.lo + (domain.hi - domain.lo) * frac}
			<line
				x1="0"
				x2={plotW}
				y1={y(watts)}
				y2={y(watts)}
				stroke="currentColor"
				stroke-width="1"
				class="text-neon opacity-20"
			/>
			<text
				x={plotW + 8}
				y={y(watts) + 4}
				class="fill-muted font-display text-[12px]">{Math.round(watts)} W</text
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
		<path
			d={ftpPath}
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			class="text-ink"
		/>
		{#each rides.filter((r) => r.best20m > 0) as ride (ride.id)}
			<circle
				cx={x(ride.date)}
				cy={y(ride.best20m)}
				r={hovered === ride ? 7 : 5.5}
				class="fill-z2"
			/>
		{/each}
		<text x="0" y={H - 8} class="fill-muted font-display text-[12px]"
			>{monthLabel(rides[0].date)}</text
		>
		{#if rides.length > 1}
			<text
				x={plotW}
				y={H - 8}
				text-anchor="end"
				class="fill-muted font-display text-[12px]"
				>{monthLabel(rides[rides.length - 1].date)}</text
			>
		{/if}
		{#if hovered}
			<line
				x1={x(hovered.date)}
				x2={x(hovered.date)}
				y1={PAD.top}
				y2={H - PAD.bottom}
				stroke="currentColor"
				stroke-width="1"
				class="text-muted opacity-60"
			/>
			<ChartTip
				x={x(hovered.date)}
				y={y(Math.max(hovered.ftp, hovered.best20m))}
				maxX={W}
				lines={[
					monthLabel(hovered.date),
					hovered.best20m > 0
						? `best 20 min ${hovered.best20m} W · FTP ${hovered.ftp} W`
						: `FTP ${hovered.ftp} W`,
				]}
			/>
		{/if}
	</svg>
</div>
