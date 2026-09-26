<script lang="ts">
	// "Am I on target", as one instrument — used by every surface where you are
	// riding, which is the point: the group session, the solo ride and the ramp
	// test were three different designs for one activity.
	//
	// The number is a needle. It travels horizontally with your power over a
	// track that marks the tolerance band, so "left or right of the bright
	// slot" reads before any digit does. clamp() keeps it on screen at 0 W and
	// at a sprint without a resize observer.
	import {
		CEILING,
		fillPct,
		ZONE_BG,
		ZONE_NAMES,
		zoneOf,
	} from '$lib/components/zones';
	import { targetState } from '$lib/channel/types';
	import ZoneDot from '$lib/components/ZoneDot.svelte';

	// Primitives, not a LiveRider: the solo ride and the ramp test have watts
	// and a target without a roster to belong to, and coupling the instrument
	// to the voice channel's view model is what kept them on a separate design.
	let {
		watts,
		target,
		ftp,
		compact = false,
		tv = false,
		targetLabel = 'target',
		fullScale = undefined,
		stale = false,
	}: {
		watts: number;
		target: number;
		ftp: number;
		/** Collapsed to a single bar — what it becomes under a shared player. */
		compact?: boolean;
		/** TV mode: the same instrument sized in vh, so it holds at 3 m on any
		 *  panel. One design at two distances, not two designs. */
		tv?: boolean;
		/** The ramp test prescribes a step, not a target. */
		targetLabel?: string;
		/** The right-hand end of the track in watts; FTP × 1.5 unless said (#1565). */
		fullScale?: number;
		/**
		 * Nothing is being measured (#2851): the trainer went quiet, and what
		 * is left is its last number. Glow means live (ADR-0005), so it goes,
		 * the number with it, and the line says why — a rider three metres
		 * away reads the number, not the banner above it.
		 */
		stale?: boolean;
	} = $props();

	const pct = (w: number) => fillPct(w, ftp, fullScale);
	const shown = $derived(stale ? 0 : watts);
	const state = $derived(targetState({ watts: shown, target }));
	const zone = $derived(zoneOf(shown, ftp));
	const numeral = $derived(stale ? 'text-muted' : 'text-watt glow-text-strong');
</script>

{#snippet track(height: string)}
	<div class="relative {height}">
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
			<div
				class="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
				style="width: {pct(shown)}%"
			>
				<div
					data-testid="gauge-fill"
					class="{ZONE_BG[zone]} h-full w-full"
				></div>
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
{/snippet}

{#if compact}
	<div class="flex items-center gap-6">
		<span class="flex shrink-0 items-baseline gap-1.5">
			<span
				class="font-display {numeral} text-4xl leading-none font-bold tabular-nums"
				>{stale ? '—' : watts}</span
			>
			<span class="eyebrow">w</span>
		</span>
		<span class="min-w-0 flex-1">{@render track('h-3')}</span>
		<span
			class="shrink-0 text-xs tabular-nums {state.inBand
				? 'text-z4'
				: 'text-muted'}"
			>{stale
				? 'no signal'
				: state.has
					? `${targetLabel} ${target} W`
					: 'no target'}</span
		>
	</div>
{:else}
	<!-- In flow, not pinned to the foot of a fixed box (#2888): 112 px held
	     about 130 of number, "watts" and zone line, and the rest spilled up
	     over whatever named the number — a phone's "watching …". The floor
	     reserves all three lines so the zone line arriving moves nothing. -->
	<div
		data-testid="instrument-readout"
		class="flex items-end {tv ? 'min-h-[22vh]' : 'min-h-32'}"
	>
		<div
			class="relative w-max -translate-x-1/2 text-center transition-[left] duration-500 ease-out"
			style="left: clamp({tv ? '10vh' : '5rem'}, {pct(shown)}%, calc(100% - {tv
				? '10vh'
				: '5rem'}))"
		>
			<span
				class="font-display {numeral} block leading-[0.85] font-bold tabular-nums {tv
					? 'text-[16vh]'
					: 'text-[6.5rem]'}">{stale ? '—' : watts}</span
			>
			<span class="eyebrow {tv ? 'text-[1.6vh]' : ''}">watts</span>
			<!-- The zone you are actually in, named (#1531, ADR-0046): the gauge
			     has been tinted by it since #386 and never said which one, so the
			     colour was a code with no key on the one screen that could give
			     it one. Silent at 0 W — Z1 for a rider who stopped is a lie. -->
			{#if shown > 0}
				<!-- Muted words and a zone dot (#2856): the ramp is fitted to a
				     fill's floor, and Z1 written in its own colour was 2.1:1. -->
				<span
					class="eyebrow flex items-center justify-center gap-1 {tv
						? 'text-[1.6vh]'
						: ''}"
					><ZoneDot {zone} class={tv ? 'size-[1vh]' : 'size-1.5'} />z{zone}
					{ZONE_NAMES[zone]}</span
				>
			{/if}
		</div>
	</div>

	<div class={tv ? 'mt-[1.5vh]' : 'mt-3'}>
		{@render track(tv ? 'h-[4vh]' : 'h-12')}
	</div>

	<div
		class="text-muted flex items-baseline tabular-nums {tv
			? 'mt-[1vh] text-[1.8vh]'
			: 'mt-2 text-xs'}"
	>
		<span>0</span>
		<span
			class="mx-auto {tv ? 'text-[2.6vh]' : 'text-sm'} {state.inBand
				? 'text-z4'
				: state.delta > 0
					? 'text-z5'
					: 'text-muted'}"
		>
			{#if stale}
				no signal
			{:else if !state.has}
				no {targetLabel} — spin easy
			{:else if state.inBand}
				on {targetLabel} · {target} W
			{:else}
				{state.delta > 0 ? '+' : ''}{state.delta} W · aim for {target}
			{/if}
		</span>
		<span>{Math.round(fullScale ?? ftp * CEILING)}</span>
	</div>
{/if}
