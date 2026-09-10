<script lang="ts">
	// FTP over time as a step line (captured at ride time — history, not
	// reconstruction), each ride's best 20-min effort as a dot (#222), and the
	// FTP a ramp test SET as a diamond on the ramp's own ride (#1572). Drawn
	// 1:1 in container pixels so type never scales down; neon grid per
	// ADR-0005. Identity is carried by shape (line, dot, diamond) plus the
	// legend, never color alone. Hover for a ride's numbers; click to jump.
	import ChartTip from '$lib/components/ChartTip.svelte';
	import type { TrendRide } from '$lib/progression';
	import { atMs, ftpMarks, trendDomain, trendSparse } from './ftp-trend';

	let {
		rides,
		onpick,
		height = 240,
	}: {
		rides: TrendRide[];
		onpick?: (ride: TrendRide) => void;
		height?: number;
	} = $props();

	// What the chart can draw, and how wide its axis has to be, live in
	// ftp-trend.ts — where they can be tested without a DOM (#1572).
	const sparse = $derived(trendSparse(rides));
	// The rides that SET an FTP — a ramp test's own, and nothing else.
	const marks = $derived(ftpMarks(rides));

	let width = $state(600);
	const W = $derived(Math.max(width, 280));
	const H = $derived(height);
	const PAD = { top: 18, bottom: 28, right: 56 };
	const plotW = $derived(W - PAD.right);
	const plotH = $derived(H - PAD.top - PAD.bottom);

	const span = $derived.by(() => {
		const first = atMs(rides[0].date);
		const last = atMs(rides[rides.length - 1].date);
		return { first, len: Math.max(last - first, 1) };
	});
	const x = (d: string) => ((atMs(d) - span.first) / span.len) * plotW;

	const domain = $derived(trendDomain(rides));
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

{#if sparse}
	<p class="text-muted text-sm leading-relaxed">
		Your FTP history appears here once there is one to draw — two rides is where
		a line starts. It follows the FTP your rides were scored against, a ride
		with a hard 20 minutes adds a dot, and a ramp test marks the FTP it set on
		the ride you set it in.
	</p>
{:else}
	<div class="flex items-center gap-4 text-xs" role="list" aria-label="legend">
		<span class="text-muted flex items-center gap-1.5" role="listitem">
			<span class="bg-ink inline-block h-0.5 w-4"></span>
			FTP
		</span>
		<span class="text-muted flex items-center gap-1.5" role="listitem">
			<span class="bg-z2 inline-block h-2.5 w-2.5 rounded-full"></span>
			best 20 min of a ride
		</span>
		{#if marks.length > 0}
			<!-- Only when there is one to explain (ux.md capability gating): a
			     rider who has never tested is not taught a mark they have not
			     got. Shape carries the identity, the colour reinforces it. -->
			<span class="text-muted flex items-center gap-1.5" role="listitem">
				<span class="bg-watt inline-block h-2 w-2 rotate-45"></span>
				FTP a ramp test set
			</span>
		{/if}
	</div>

	<div class="mt-3 w-full" bind:clientWidth={width}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<svg
			viewBox="0 0 {W} {H}"
			width="100%"
			height={H}
			class="block {onpick ? 'cursor-pointer' : ''}"
			role="img"
			aria-label={marks.length > 0
				? 'FTP, 20-minute bests and the FTP each ramp test set, over time'
				: 'FTP and 20-minute bests over time'}
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
					class="fill-muted font-display text-[12px]"
					>{Math.round(watts)} W</text
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
			<!-- The FTP a ramp test set, on the ramp's own ride (#1572). A
			     DIAMOND, not a second circle: the 20-min dots are a per-ride
			     effort and this is the moment the line moved, and the two must
			     not read as one series. Watt magenta because it is a number the
			     rider measured, flat because it is not live (ADR-0005); the
			     panel-coloured stroke keeps it legible where it lands on a
			     20-minute dot. -->
			{#each marks as ride (ride.id)}
				{@const r = hovered === ride ? 8 : 6.5}
				{@const cx = x(ride.date)}
				{@const cy = y(ride.ftpAfter ?? 0)}
				<path
					d="M {cx} {cy - r} L {cx + r} {cy} L {cx} {cy + r} L {cx - r} {cy} Z"
					class="fill-watt stroke-surface-raised"
					stroke-width="1.5"
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
					y={y(Math.max(hovered.ftp, hovered.best20m, hovered.ftpAfter ?? 0))}
					maxX={W}
					lines={[
						monthLabel(hovered.date),
						hovered.best20m > 0
							? `best 20 min ${hovered.best20m} W · FTP ${hovered.ftp} W`
							: `FTP ${hovered.ftp} W`,
						...(hovered.ftpAfter
							? [`ramp test set FTP ${hovered.ftpAfter} W`]
							: []),
					]}
				/>
			{/if}
		</svg>
	</div>
{/if}
