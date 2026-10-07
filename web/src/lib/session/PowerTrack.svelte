<script lang="ts">
	// Your power as a fill over a track that marks the target's band: "left
	// or right of the bright slot" reads before any digit does. The
	// Instrument's gauge and the bike computer's target track (#3668) are
	// this one drawing.
	import { fillPct, ZONE_BG, zoneOf } from '$lib/components/zones';
	import { targetState } from '$lib/channel/types';

	let {
		watts,
		target,
		ftp,
		fullScale = undefined,
		class: extra = '',
	}: {
		/** What is shown: 0 while nothing is measured. */
		watts: number;
		target: number;
		ftp: number;
		/** The right-hand end of the track in watts; FTP × 1.5 unless said (#1565). */
		fullScale?: number;
		/** Its height, the caller's. */
		class?: string;
	} = $props();

	const pct = (w: number) => fillPct(w, ftp, fullScale);
	const state = $derived(targetState({ watts, target }));
	const zone = $derived(zoneOf(watts, ftp));
</script>

<div class="relative {extra}">
	<div
		data-testid="power-gauge"
		class="bg-surface-raised absolute inset-0 overflow-hidden rounded-full forced-colors:border"
	>
		<!-- Forced colours (#2860): the track keeps an edge, and the slot and
		     the target speak Highlight; app.css paints the fill. -->
		{#if state.has}
			<!-- The slot you are aiming at. -->
			<div
				data-testid="gauge-slot"
				class="bg-neon/30 absolute inset-y-0 forced-color-adjust-none forced-colors:bg-[Highlight]/40"
				style="left: {pct(target - state.band)}%; width: {pct(
					target + state.band,
				) - pct(target - state.band)}%"
			></div>
		{/if}
		<!-- Literal zone class: Tailwind scans source text, so a composed
		     `bg-z3/60` is never generated (zones.ts). Full strength — the ramp
		     is contrast-gated at 3:1 and dimming it voids that. -->
		<!-- Scaled, not sized (#2998): a width transition repaints the fill
		     on every frame of its glide, and with it anything sharing its
		     layer — the glowing number above, once, cost 18% GPU. A solid
		     colour clipped by the track looks the same either way. -->
		<div
			class="ease-live absolute inset-0 origin-left transition-transform duration-[250ms]"
			style="transform: scaleX({pct(watts) / 100})"
		>
			<div data-testid="gauge-fill" class="{ZONE_BG[zone]} h-full w-full"></div>
		</div>
		{#if state.has}
			<div
				data-testid="gauge-target"
				class="bg-neon absolute inset-y-0 w-1 forced-color-adjust-none forced-colors:bg-[Highlight]"
				style="left: {pct(target)}%"
			></div>
		{/if}
	</div>
</div>
