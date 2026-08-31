<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { wkg } from '$lib/format';
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
		// All three, always (#181 feedback) — the tile filters zeros itself.
		metrics = ['hr', 'cadence', 'wkg'],
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
								text: wkg(rider.watts, rider.kg),
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
		: 'ring-ink/10'}"
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
		<!-- Camera off: the rider's hue keeps the seat warm (#181) — quieter than
		     a feed so cam-on still reads at a glance — and the mark stands in
		     for the person, moving when they ride. -->
		<div
			class="absolute inset-0"
			style="background: linear-gradient(160deg, hsl({rider.hue} 30% 15%), hsl({rider.hue +
				30} 25% 7%))"
		></div>
		<div class="absolute inset-0 grid place-items-center">
			<Logo size={44} {live} />
		</div>
	{/if}

	<!-- Name and voice state, top-left; kept off the power bar's edge. -->
	<div class="absolute top-2 left-2.5 flex items-center gap-1.5">
		<span class="text-ink text-xs font-medium drop-shadow">{rider.name}</span>
		{#if rider.coach}
			<span
				class="bg-paper/40 text-ink/80 rounded-full px-1.5 py-0.5 text-[9px]"
				>coach</span
			>
		{/if}
		{#if rider.inVoice && !rider.muted}
			<span
				class="bg-z4 h-1.5 w-1.5 rounded-full"
				title="in voice"
				aria-label="in voice"
			></span>
		{:else if rider.muted}
			<span
				class="bg-paper/40 text-ink/70 rounded-full px-1.5 py-0.5 text-[9px]"
				title="muted">mic off</span
			>
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
					: 'text-ink'}">{rider.watts}</span
			>
			<span class="text-ink/60 text-[10px]">W</span>
		</div>
	{/if}

	{#if rider.paused}
		<div class="bg-paper/55 absolute inset-0 grid place-items-center">
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
			<span class="bg-neon/80 text-ink rounded-full px-2 py-0.5 text-[10px]"
				>joined · synced to 24:07</span
			>
		</div>
	{/if}

	{#if rider.stale}
		<div class="bg-paper/55 absolute inset-0 grid place-items-center">
			<span class="text-z5 text-[11px] font-medium tracking-wider uppercase"
				>no signal</span
			>
		</div>
	{/if}

	{#if live && extras.length && !rider.stale}
		<div
			class="text-ink/85 absolute right-2.5 bottom-3 flex gap-2.5 font-mono text-[11px] tabular-nums drop-shadow"
		>
			{#each extras as extra (extra.key)}
				<span>{extra.text}<span class="text-ink/50"> {extra.unit}</span></span>
			{/each}
		</div>
	{/if}

	<!-- The power bar is fused to the tile's bottom edge, not floating in a card. -->
	<div class="bg-paper/50 absolute inset-x-0 bottom-0 h-1.5">
		{#if live}
			<div
				class="h-full transition-[width] duration-500 ease-out {ZONE_BG[zone]}"
				style="width: {fill}%"
			></div>
		{/if}
	</div>
</div>
