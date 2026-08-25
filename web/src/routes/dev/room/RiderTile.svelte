<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import {
		ZONE_BG,
		type MockRider,
		type Phase,
		zoneOf,
	} from './mockRoom.svelte';

	let {
		rider,
		phase,
		stretch = false,
	}: { rider: MockRider; phase: Phase; stretch?: boolean } = $props();

	const live = $derived(phase === 'live' && rider.watts > 0);
	const zone = $derived(zoneOf(rider.watts, rider.ftp));
	/** Bar fills at 150 % FTP, matching the interval graph's ceiling. */
	const fill = $derived(Math.min(100, (rider.watts / rider.ftp / 1.5) * 100));
</script>

<div
	class="bg-surface-raised relative overflow-hidden rounded-lg ring-1 {stretch
		? 'h-full'
		: 'aspect-video'} transition-shadow duration-200 {rider.speaking
		? 'ring-neon shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-neon)_35%,transparent)]'
		: 'ring-white/10'}"
>
	{#if rider.cameraOn}
		<!-- Stand-in for a LiveKit track: real feeds are brighter and busier than a flat fill. -->
		<div
			class="absolute inset-0"
			style="background:
				radial-gradient(120% 90% at 50% 15%, hsl({rider.hue} 45% 42%), transparent 70%),
				linear-gradient(160deg, hsl({rider.hue} 40% 22%), hsl({rider.hue +
				30} 35% 10%))"
		></div>
	{:else}
		<!-- Camera off: the mark stands in for the person, and moves when they ride. -->
		<div class="absolute inset-0 grid place-items-center">
			<Logo size={44} {live} />
		</div>
	{/if}

	<!-- Name and voice state, top-left; kept off the power bar's edge. -->
	<div class="absolute top-2 left-2.5 flex items-center gap-1.5">
		<span class="text-xs font-medium text-white drop-shadow">{rider.name}</span>
		{#if rider.coach}
			<span
				class="rounded-full bg-black/40 px-1.5 py-0.5 text-[9px] text-white/80"
				>coach</span
			>
		{/if}
		{#if rider.muted}
			<span class="text-[10px] text-white/50" title="muted">✕</span>
		{/if}
	</div>

	<!-- Power, top-right. Only your own tile glows. -->
	{#if live}
		<div class="absolute top-2 right-2.5 text-right">
			<span
				class="font-display text-2xl leading-none font-bold tabular-nums drop-shadow {rider.you
					? 'text-watt glow-text'
					: 'text-white'}">{rider.watts}</span
			>
			<span class="text-[10px] text-white/60">W</span>
		</div>
	{/if}

	<!-- The power bar is fused to the tile's bottom edge, not floating in a card. -->
	<div class="absolute inset-x-0 bottom-0 h-1.5 bg-black/50">
		{#if live}
			<div
				class="h-full transition-[width] duration-500 ease-out {ZONE_BG[zone]}"
				style="width: {fill}%"
			></div>
		{/if}
	</div>
</div>
