<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import {
		fillPct,
		type TileMetric,
		ZONE_BG,
		type MockRider,
		type Phase,
		zoneOf,
	} from '$lib/room/mockcompat';

	let {
		rider,
		phase,
		stretch = false,
		metrics = [],
		videoKey = 0,
		videoAttach,
	}: {
		rider: MockRider;
		phase: Phase;
		stretch?: boolean;
		/** Rider-chosen extras; watts is never optional. */
		metrics?: TileMetric[];
		/** Bumped when the rider's live video track changes (LiveKit). */
		videoKey?: number;
		/** Attaches the live track into the tile; the mock gradient stands in without it. */
		videoAttach?: (node: HTMLElement) => void;
	} = $props();

	const live = $derived(phase === 'live' && rider.watts > 0);
	const zone = $derived(zoneOf(rider.watts, rider.ftp));
	const fill = $derived(fillPct(rider.watts, rider.ftp));

	// value drives the zero-filter; text keeps the decimal so the column stays aligned.
	const extras = $derived(
		metrics
			.map((metric) =>
				metric === 'hr'
					? { key: metric, value: rider.hr, text: `${rider.hr}`, unit: 'bpm' }
					: metric === 'cadence'
						? {
								key: metric,
								value: rider.cadence,
								text: `${rider.cadence}`,
								unit: 'rpm',
							}
						: {
								key: metric,
								value: rider.watts,
								text: (rider.watts / rider.kg).toFixed(1),
								unit: 'w/kg',
							},
			)
			.filter((extra) => extra.value > 0),
	);
</script>

<div
	class="bg-surface-raised relative overflow-hidden rounded-lg ring-1 {stretch
		? 'h-full'
		: 'aspect-video'} transition-shadow duration-200 {rider.speaking
		? 'ring-neon shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-neon)_35%,transparent)]'
		: 'ring-white/10'}"
>
	{#if rider.cameraOn && videoAttach}
		{#key videoKey}
			<div class="absolute inset-0" {@attach (node) => videoAttach(node)}></div>
		{/key}
	{:else if rider.cameraOn}
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
		<div
			class="absolute top-2 right-2.5 text-right {rider.stale
				? 'opacity-40'
				: ''}"
		>
			<span
				class="font-display text-2xl leading-none font-bold tabular-nums drop-shadow {rider.you
					? 'text-watt glow-text'
					: 'text-white'}">{rider.watts}</span
			>
			<span class="text-[10px] text-white/60">W</span>
		</div>
	{/if}

	{#if rider.paused}
		<div class="absolute inset-0 grid place-items-center bg-black/55">
			<div class="text-center">
				<span
					class="text-muted text-[11px] font-medium tracking-wider uppercase"
					>paused</span
				>
				<span class="text-muted/70 mt-0.5 block text-[10px]"
					>stopped pedalling</span
				>
			</div>
		</div>
	{/if}

	{#if rider.lateJoined}
		<div class="absolute inset-x-0 bottom-1.5 flex justify-center">
			<span class="bg-neon/80 rounded-full px-2 py-0.5 text-[10px] text-white"
				>joined · synced to 24:07</span
			>
		</div>
	{/if}

	{#if rider.stale}
		<div class="absolute inset-0 grid place-items-center bg-black/55">
			<span class="text-z5 text-[11px] font-medium tracking-wider uppercase"
				>no signal</span
			>
		</div>
	{/if}

	{#if live && extras.length && !rider.stale}
		<div
			class="absolute right-2.5 bottom-3 flex gap-2.5 font-mono text-[11px] text-white/85 tabular-nums drop-shadow"
		>
			{#each extras as extra (extra.key)}
				<span>{extra.text}<span class="text-white/50"> {extra.unit}</span></span
				>
			{/each}
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
