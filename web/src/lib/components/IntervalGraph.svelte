<script lang="ts">
	import type { Segment } from '$lib/workout/types';
	import { CEILING, ZONE_TEXT, zoneOf } from './zones';

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
		trace: { t: number; w: number }[];
		compact?: boolean;
	} = $props();

	const W = 1000;
	const H = 120;
	const BASE = 112;
	/** Anything above the shared ceiling clips, which is honest for sprints. */
	const SCALE = (BASE - 8) / CEILING;

	const x = (seconds: number) => (seconds / total) * W;
	const y = (fraction: number) => BASE - Math.min(fraction, CEILING) * SCALE;

	const blocks = $derived(
		segments.map((seg) => {
			const from = seg.kind === 'sprint' ? CEILING : (seg.fromFraction ?? 0);
			const to = seg.kind === 'sprint' ? CEILING : (seg.toFraction ?? from);
			const x0 = x(seg.startSeconds);
			const x1 = x(seg.startSeconds + seg.seconds);
			return {
				points: `${x0},${BASE} ${x0},${y(from)} ${x1},${y(to)} ${x1},${BASE}`,
				zone: zoneOf(((from + to) / 2) * ftp, ftp),
				sprint: seg.kind === 'sprint',
			};
		}),
	);

	const tracePoints = $derived(
		trace.map((sample) => `${x(sample.t)},${y(sample.w / ftp)}`).join(' '),
	);
</script>

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
			opacity={block.sprint ? 0.35 : 0.55}
		/>
	{/each}

	{#if trace.length > 1}
		<polyline
			points={tracePoints}
			fill="none"
			stroke="white"
			stroke-width="2"
			opacity="0.7"
			vector-effect="non-scaling-stroke"
		/>
	{/if}

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
