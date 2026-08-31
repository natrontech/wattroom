<script lang="ts" module>
	export interface TrendRide {
		date: string;
		ftp: number;
		best20m: number;
	}
</script>

<script lang="ts">
	// FTP over time as a step line (it was captured at ride time, so this is
	// history, not reconstruction), with each ride's best 20-min effort as a
	// dot (#222). Identity is carried by shape (line vs dot) plus the legend,
	// never by color alone.
	let { rides }: { rides: TrendRide[] } = $props();

	const W = 600;
	const H = 190;
	const PAD = { top: 14, bottom: 22, left: 0, right: 44 };
	const plotW = W - PAD.left - PAD.right;
	const plotH = H - PAD.top - PAD.bottom;

	const t = (d: string) => new Date(d).getTime();
	const span = $derived.by(() => {
		const first = t(rides[0].date);
		const last = t(rides[rides.length - 1].date);
		return { first, len: Math.max(last - first, 1) };
	});
	const x = (d: string) => PAD.left + ((t(d) - span.first) / span.len) * plotW;

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
			.join(' ') + ` H ${(PAD.left + plotW).toFixed(1)}`,
	);

	const monthLabel = (d: string) =>
		new Date(d).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
		});
</script>

<div class="flex items-center gap-4 text-xs" role="list" aria-label="legend">
	<span class="text-muted flex items-center gap-1.5" role="listitem">
		<span class="bg-ink inline-block h-0.5 w-3.5"></span>
		FTP
	</span>
	<span class="text-muted flex items-center gap-1.5" role="listitem">
		<span class="bg-z2 inline-block h-2.5 w-2.5 rounded-full"></span>
		best 20 min of a ride
	</span>
</div>

<svg
	viewBox="0 0 {W} {H}"
	class="mt-2 w-full"
	role="img"
	aria-label="FTP and 20-minute bests over time"
>
	{#each [0.5, 1] as frac (frac)}
		{@const watts = domain.lo + (domain.hi - domain.lo) * frac}
		<line
			x1="0"
			x2={W - PAD.right}
			y1={y(watts)}
			y2={y(watts)}
			stroke="currentColor"
			stroke-width="1"
			class="text-muted opacity-20"
			vector-effect="non-scaling-stroke"
		/>
		<text
			x={W - PAD.right + 6}
			y={y(watts) + 4}
			class="fill-muted font-display text-[11px] opacity-60"
			>{Math.round(watts)} W</text
		>
	{/each}
	<path
		d={ftpPath}
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		class="text-ink"
		vector-effect="non-scaling-stroke"
	/>
	{#each rides.filter((r) => r.best20m > 0) as ride (ride.date)}
		<circle cx={x(ride.date)} cy={y(ride.best20m)} r="4.5" class="fill-z2">
			<title
				>{monthLabel(ride.date)} · best 20 min {ride.best20m} W · FTP {ride.ftp}
				W</title
			>
		</circle>
	{/each}
	<text x={PAD.left} y={H - 6} class="fill-muted font-display text-[11px]"
		>{monthLabel(rides[0].date)}</text
	>
	{#if rides.length > 1}
		<text
			x={PAD.left + plotW}
			y={H - 6}
			text-anchor="end"
			class="fill-muted font-display text-[11px]"
			>{monthLabel(rides[rides.length - 1].date)}</text
		>
	{/if}
</svg>
