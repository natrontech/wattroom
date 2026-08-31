<script lang="ts">
	import { formatClock } from '$lib/format';
	import type { Segment } from '$lib/workout/types';
	import { splitTrace, type TracePoint } from './trace';
	import { CEILING, ZONE_NAMES, ZONE_TEXT, zoneOf } from './zones';

	let {
		segments,
		total,
		elapsed,
		ftp,
		trace,
		compact = false,
	}: {
		segments: Segment[];
		total: number;
		elapsed: number;
		ftp: number;
		trace: TracePoint[];
		compact?: boolean;
	} = $props();

	const W = 1000;
	const H = 120;
	const BASE = 112;
	/** Anything above the shared ceiling clips, which is honest for sprints. */
	const SCALE = (BASE - 8) / CEILING;

	const x = (seconds: number) => (seconds / total) * W;
	const y = (fraction: number) => BASE - Math.min(fraction, CEILING) * SCALE;

	function targetText(seg: Segment, from: number, to: number): string {
		if (seg.watts !== undefined) return `${seg.watts} W`;
		const a = Math.round(from * 100);
		const b = Math.round(to * 100);
		return a === b ? `${a}% FTP` : `${a} → ${b}% FTP`;
	}

	const blocks = $derived(
		segments.map((seg) => {
			const from =
				seg.kind === 'sprint'
					? CEILING
					: seg.watts !== undefined
						? seg.watts / ftp
						: (seg.fromFraction ?? 0);
			const to =
				seg.kind === 'sprint'
					? CEILING
					: seg.watts !== undefined
						? from
						: (seg.toFraction ?? from);
			const x0 = x(seg.startSeconds);
			const x1 = x(seg.startSeconds + seg.seconds);
			const zone =
				seg.kind === 'sprint' ? 7 : zoneOf(((from + to) / 2) * ftp, ftp);
			return {
				points: `${x0},${BASE} ${x0},${y(from)} ${x1},${y(to)} ${x1},${BASE}`,
				edge: `${x0},${y(from)} ${x1},${y(to)}`,
				zone,
				sprint: seg.kind === 'sprint',
				label:
					seg.kind === 'sprint'
						? `Sprint — all out · ${formatClock(seg.seconds)}`
						: `Z${zone} ${ZONE_NAMES[zone]} · ${targetText(seg, from, to)} · ${formatClock(seg.seconds)}`,
			};
		}),
	);

	// One polyline per continuously-ridden run: skip and extend make the clock jump,
	// and a single line across those jumps draws work that never happened.
	const runs = $derived(
		splitTrace(trace).map((run) =>
			run.map((sample) => `${x(sample.t)},${y(sample.w / ftp)}`).join(' '),
		),
	);
</script>

<div class="relative">
	<svg
		viewBox="0 0 {W} {H}"
		class="w-full {compact ? 'h-14' : 'h-28'}"
		preserveAspectRatio="none"
	>
		{#each blocks as block, i (i)}
			<polygon
				points={block.points}
				class={ZONE_TEXT[block.zone]}
				fill="currentColor"
				opacity={block.sprint ? 0.3 : 0.45}
			>
				<title>{block.label}</title>
			</polygon>
		{/each}
		<!-- Crisp top edge per block: the profile's shape, not just its tint. -->
		{#each blocks as block, i (i)}
			<polyline
				points={block.edge}
				class={ZONE_TEXT[block.zone]}
				fill="none"
				stroke="currentColor"
				stroke-width={compact ? 1.5 : 2}
				opacity="0.9"
				vector-effect="non-scaling-stroke"
			/>
		{/each}

		<!-- FTP reference over the fills: the one line that gives every block scale. -->
		<line
			x1="0"
			y1={y(1)}
			x2={W}
			y2={y(1)}
			class="text-muted opacity-50"
			stroke="currentColor"
			stroke-width="1"
			stroke-dasharray="6 5"
			vector-effect="non-scaling-stroke"
		/>

		{#each runs as points, i (i)}
			<!-- ink, not white (ADR-0005): the trace has to survive daylight surfaces. -->
			<polyline
				{points}
				class="text-ink"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				opacity="0.7"
				vector-effect="non-scaling-stroke"
			/>
		{/each}

		{#if elapsed > 0}
			<!-- watt marks live data only — previews pass elapsed 0 and get no cursor. -->
			<line
				x1={x(elapsed)}
				y1="0"
				x2={x(elapsed)}
				y2={BASE}
				class="text-watt glow-stroke"
				stroke="currentColor"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
			/>
		{/if}
		<line
			x1="0"
			y1={BASE}
			x2={W}
			y2={BASE}
			stroke="currentColor"
			stroke-width="1"
			class="text-muted opacity-40"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
	{#if !compact}
		<!-- HTML, not <text>: preserveAspectRatio="none" would stretch glyphs. -->
		<span
			class="text-muted pointer-events-none absolute right-1.5 -translate-y-full font-mono text-[9px] tracking-widest"
			style="top: {(y(1) / H) * 100}%">FTP</span
		>
	{/if}
</div>
