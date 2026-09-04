<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { wkg } from '$lib/format';
	import { MicOff } from '@lucide/svelte';
	import {
		AWAY_MARK,
		MARK_SURFACE,
		MUTED_MARK,
		tileFrame,
		VOICE_DOT,
	} from '$lib/room/presence-marks';
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
	class="bg-surface-raised @container relative overflow-hidden rounded-lg {stretch
		? 'h-full'
		: 'aspect-video'} transition-shadow duration-200 {tileFrame(
		rider.speaking,
		rider.away,
	)}"
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
		     for the person, moving when they ride. The hue is a wash over the
		     raised surface on paper and the cave's own dark gradient below it
		     (#505): a dark seat under a white scrim read as fog. -->
		<div
			class="absolute inset-0"
			style="background: linear-gradient(160deg,
				light-dark(color-mix(in oklab, hsl({rider.hue} 65% 55%) 16%, var(--color-surface-raised)), hsl({rider.hue} 30% 15%)),
				light-dark(color-mix(in oklab, hsl({rider.hue +
				30} 60% 50%) 8%, var(--color-surface-raised)), hsl({rider.hue +
				30} 25% 7%)))"
		></div>
		<div class="absolute inset-0 grid place-items-center">
			<Logo size={44} {live} />
		</div>
	{/if}

	{#if rider.cameraOn}
		<!-- Overlay scrim (#319): ink is white in the cave, and a bright camera
		     feed swallowed the readouts whole. Over the frame only — the
		     camera-off seat is a surface we chose, and readouts sit on it at
		     full contrast rather than under a wash (#505). -->
		<div
			class="pointer-events-none absolute inset-0"
			style="background: linear-gradient(to bottom,
				color-mix(in oklab, var(--color-paper) 60%, transparent) 0%,
				transparent 30%,
				transparent 55%,
				color-mix(in oklab, var(--color-paper) 70%, transparent) 100%)"
		></div>
	{/if}

	<!-- Name and voice state, top-left; kept off the power bar's edge. -->
	<div class="absolute top-2 left-2.5 flex max-w-[62%] items-center gap-1.5">
		<span class="text-ink truncate text-sm font-semibold">{rider.name}</span>
		{#if rider.coach}
			<span class="{MARK_SURFACE} rounded-full px-1.5 py-0.5 text-[9px]"
				>coach</span
			>
		{/if}
		{#if rider.inVoice && !rider.muted}
			<span class={VOICE_DOT} title="in voice" aria-label="in voice"></span>
		{:else if rider.muted}
			<MicOff size={12} class={MUTED_MARK} aria-label="muted" />
		{/if}
	</div>

	<!-- Power, top-right. Only your own tile glows. -->
	{#if live}
		<div
			class="absolute top-2 right-2.5 text-right {rider.stale
				? 'opacity-40'
				: ''}"
		>
			<!-- No drop-shadow: on paper a shadow under near-black numerals is
			     the blur the rider reported (#505); the scrim carries them. -->
			<span
				class="font-display text-2xl leading-none font-bold tabular-nums {rider.you
					? 'text-watt glow-text'
					: 'text-ink'}">{rider.watts}</span
			>
			<span class="text-ink/80 text-xs font-medium">W</span>
		</div>
	{/if}

	{#if rider.away}
		<div class="pointer-events-none absolute inset-0 grid place-items-center">
			<span class={AWAY_MARK}>away</span>
		</div>
	{/if}

	{#if rider.paused}
		<div class="bg-surface/70 absolute inset-0 grid place-items-center">
			<div class="text-center">
				<span class="text-ink text-[11px] font-medium tracking-wider uppercase"
					>paused</span
				>
				<span class="text-muted mt-0.5 block text-[10px]"
					>stopped pedalling</span
				>
			</div>
		</div>
	{/if}

	{#if rider.lateJoined}
		<div class="absolute inset-x-0 bottom-1.5 flex justify-center">
			<!-- The chip surface, not a neon fill: ink on 80 % neon is white on
			     violet in the cave and near-black on violet on paper (#505). -->
			<span class="{MARK_SURFACE} rounded-full px-2 py-0.5 text-[10px]"
				>joined · synced to 24:07</span
			>
		</div>
	{/if}

	{#if rider.stale}
		<!-- A badge, not a curtain: a quiet trainer says nothing about their
		     camera, and the dimmed watts above already read "last known". -->
		<div class="absolute inset-x-0 bottom-2.5 flex justify-center">
			<span
				class="bg-surface/85 text-z5 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase"
				>no signal</span
			>
		</div>
	{/if}

	{#if live && extras.length && !rider.stale}
		<div
			class="text-ink absolute right-2.5 bottom-3 flex gap-3 font-mono text-xs font-medium tabular-nums"
		>
			{#each extras as extra (extra.key)}
				<span class={extra.key === 'wkg' ? 'hidden @[10rem]:inline' : ''}
					>{extra.text}<span class="text-ink/80"> {extra.unit}</span></span
				>
			{/each}
		</div>
	{/if}

	<!-- The power bar is fused to the tile's bottom edge, not floating in a card.
	     Its track is the edge colour: paper IS the tile in the white family, so
	     a paper track left the empty bar with nowhere to sit (#505). -->
	<div class="bg-edge absolute inset-x-0 bottom-0 h-1.5">
		{#if live}
			<div
				class="h-full transition-[width] duration-500 ease-out {ZONE_BG[zone]}"
				style="width: {fill}%"
			></div>
		{/if}
	</div>
</div>
