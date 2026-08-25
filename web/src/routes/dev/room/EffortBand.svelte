<script lang="ts">
	import { bandWatts, type MockRider } from './mockRoom.svelte';

	let { you }: { you: MockRider } = $props();

	/** ±25 % FTP off target spans the band; beyond that you pin to the edge. */
	const SPAN = 0.25;

	const delta = $derived(
		you.target > 0 ? (you.watts - you.target) / you.ftp : 0,
	);
	const offset = $derived(
		50 - (Math.max(-SPAN, Math.min(SPAN, delta)) / SPAN) * 46,
	);
	const bandPct = $derived(
		you.target > 0 ? (bandWatts(you.target) / you.ftp / SPAN) * 46 : 0,
	);
	const inBand = $derived(
		you.target > 0 && Math.abs(you.watts - you.target) <= bandWatts(you.target),
	);
</script>

<!--
	The salvaged horizon, compact: your target is the line, you ride above or below it,
	and the corridor brightens when you leave it. Same geometry as Floor is Lava.
-->
<div
	class="bg-surface-raised relative h-24 overflow-hidden rounded-lg ring-1 ring-white/10"
>
	<div class="bg-gridlines absolute inset-0 opacity-30"></div>

	<div
		class="absolute inset-x-0 transition-opacity duration-300"
		style="top: {50 - bandPct}%; height: {bandPct * 2}%;
			background: linear-gradient(to bottom, transparent, color-mix(in oklab, var(--color-neon) 26%, transparent), transparent);
			opacity: {inBand ? 0.55 : 1}"
	></div>

	<div
		class="bg-neon absolute inset-x-0 top-1/2 h-px"
		style="box-shadow: 0 0 10px color-mix(in oklab, var(--color-neon) 45%, transparent)"
	></div>

	<div
		class="absolute right-4 flex -translate-y-1/2 items-center gap-3 transition-[top] duration-700 ease-out"
		style="top: {offset}%"
	>
		<div class="text-watt glow-stroke h-1 w-16 rounded-full bg-current"></div>
		<div class="text-right">
			<span
				class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
				>{you.watts}</span
			>
			<span class="text-muted ml-1 text-sm">W</span>
		</div>
	</div>

	<div
		class="text-muted absolute top-1/2 left-4 -translate-y-1/2 text-[10px] tracking-wider uppercase"
	>
		{you.target > 0 ? `target ${you.target} W` : 'no target'}
	</div>
</div>
