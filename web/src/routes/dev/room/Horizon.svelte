<script lang="ts">
	import type { MockRider } from './mockRoom.svelte';

	let {
		riders,
		progress,
	}: {
		riders: MockRider[];
		/** 0..1 through the whole session — drives the sun */
		progress: number;
	} = $props();

	/** Horizon sits below centre so there is sky to climb into. */
	const HORIZON = 58;
	/** ±30 % FTP off target maps to ±40 % of the scene height. Beyond that, you clamp. */
	const SPAN = 0.3;
	const REACH = 40;

	const you = $derived(riders.find((r) => r.you)!);

	/** Vertical position as a fraction of FTP away from your own target — mixed groups stay fair. */
	function offset(rider: MockRider): number {
		if (rider.target <= 0) return HORIZON;
		const delta = (rider.watts - rider.target) / rider.ftp;
		const clamped = Math.max(-SPAN, Math.min(SPAN, delta));
		return HORIZON - (clamped / SPAN) * REACH;
	}

	/** Half-height of the tolerance corridor: ±5 % of target, floor ±10 W (docs/SPEC.md). */
	const bandPct = $derived.by(() => {
		if (you.target <= 0) return 0;
		const watts = Math.max(you.target * 0.05, 10);
		return (watts / you.ftp / SPAN) * REACH || 0;
	});

	const inBand = $derived(
		Math.abs(you.watts - you.target) <= Math.max(you.target * 0.05, 10),
	);

	/** The room's collective effort sets how fast the ground goes by. */
	const gridSeconds = $derived.by(() => {
		const effort =
			riders.reduce((sum, r) => sum + r.watts / r.ftp, 0) /
			Math.max(1, riders.length);
		// 50 % FTP → a slow 3 s cycle; 120 % FTP → a frantic 0.6 s one.
		return Math.max(0.6, Math.min(3, 3 - (effort - 0.5) * 3.4)).toFixed(2);
	});

	const sunTop = $derived(HORIZON - 34 + progress * 36);
	const others = $derived(riders.filter((r) => !r.you));
</script>

<div
	class="bg-surface relative h-[62vh] min-h-[420px] overflow-hidden rounded-lg"
	style="--grid-seconds: {gridSeconds}s"
>
	<!-- Sky -->
	<div
		class="absolute inset-x-0 top-0"
		style="height: {HORIZON}%; background: linear-gradient(to bottom, #0a0118 0%, #1a0736 60%, #3b1060 100%)"
	></div>

	<!-- The session's sun: it sets as the workout runs down -->
	<div
		class="absolute left-1/2 -translate-x-1/2"
		style="top: {sunTop}%; width: 240px; height: 240px"
	>
		<svg viewBox="0 0 240 240" class="h-full w-full">
			<defs>
				<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="var(--color-watt)" />
					<stop offset="100%" stop-color="var(--color-neon)" />
				</linearGradient>
				<mask id="sunslices">
					<rect x="0" y="0" width="240" height="240" fill="white" />
					<rect x="0" y="132" width="240" height="6" fill="black" />
					<rect x="0" y="152" width="240" height="9" fill="black" />
					<rect x="0" y="178" width="240" height="13" fill="black" />
					<rect x="0" y="210" width="240" height="18" fill="black" />
				</mask>
			</defs>
			<circle
				cx="120"
				cy="120"
				r="96"
				fill="url(#sun)"
				mask="url(#sunslices)"
				opacity="0.5"
			/>
		</svg>
	</div>

	<!-- Ground: the grid scrolls at the room's collective effort -->
	<div
		class="absolute inset-x-0 bottom-0 overflow-hidden"
		style="height: {100 - HORIZON}%"
	>
		<div class="grid-plane absolute -left-1/2 h-[300%] w-[200%]"></div>
	</div>

	<!-- Tolerance corridor: the light you try to stay inside -->
	<div
		class="absolute inset-x-0 transition-opacity duration-300"
		style="top: {HORIZON - bandPct}%; height: {bandPct *
			2}%; background: linear-gradient(to bottom, transparent, color-mix(in oklab, var(--color-neon) 22%, transparent), transparent); opacity: {inBand
			? 0.5
			: 1}"
	></div>

	<!-- Horizon = your target. Chrome, so it never glows. -->
	<div
		class="bg-neon absolute inset-x-0 h-px"
		style="top: {HORIZON}%; box-shadow: 0 0 12px color-mix(in oklab, var(--color-neon) 45%, transparent)"
	></div>

	<!-- The rest of the room, spread around the same line -->
	{#each others as rider (rider.name)}
		<div
			class="absolute flex -translate-y-1/2 items-center gap-2 transition-[top] duration-700 ease-out"
			style="top: {offset(rider)}%; left: {6 + others.indexOf(rider) * 13}%"
		>
			<div class="bg-muted/70 h-0.5 w-10 rounded-full"></div>
			<span class="text-muted font-mono text-[11px] tabular-nums">
				{rider.name}
				<span class="text-white/70">{rider.watts}</span>
			</span>
		</div>
	{/each}

	<!-- You. The only thing on screen that glows. -->
	<div
		class="absolute right-[6%] flex -translate-y-1/2 items-center gap-4 transition-[top] duration-700 ease-out"
		style="top: {offset(you)}%"
	>
		<div class="text-watt glow-stroke h-1 w-24 rounded-full bg-current"></div>
		<div class="text-right">
			<div
				class="text-watt glow-text-strong font-display text-6xl leading-none font-bold tabular-nums"
			>
				{you.watts}
			</div>
			<div class="text-muted text-[10px] tracking-wider uppercase">
				{you.target > 0 ? `target ${you.target} W` : 'free ride'}
			</div>
		</div>
	</div>
</div>

<style>
	.grid-plane {
		background-image:
			repeating-linear-gradient(
				to right,
				color-mix(in oklab, var(--color-neon) 55%, transparent) 0 1px,
				transparent 1px 64px
			),
			repeating-linear-gradient(
				to bottom,
				color-mix(in oklab, var(--color-neon) 55%, transparent) 0 2px,
				transparent 2px 64px
			);
		transform: perspective(300px) rotateX(64deg);
		transform-origin: top center;
		animation: approach var(--grid-seconds) linear infinite;
		mask-image: linear-gradient(to bottom, black 0%, transparent 55%);
	}

	@keyframes approach {
		from {
			background-position-y: 0;
		}
		to {
			background-position-y: 64px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.grid-plane {
			animation: none;
		}
	}
</style>
