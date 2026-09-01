<script lang="ts">
	// "Am I on target", as one instrument — used by every surface where you are
	// riding, which is the point: the group session, the solo ride and the ramp
	// test were three different designs for one activity.
	//
	// The number is a needle. It travels horizontally with your power over a
	// track that marks the tolerance band, so "left or right of the bright
	// slot" reads before any digit does. clamp() keeps it on screen at 0 W and
	// at a sprint without a resize observer.
	import { fillPct, ZONE_BG, zoneOf } from '$lib/components/zones';
	import { targetState } from '$lib/room/view';

	// Primitives, not a RoomRider: the solo ride and the ramp test have watts
	// and a target without a roster to belong to, and coupling the instrument
	// to the room's view model is what kept them on a separate design.
	let {
		watts,
		target,
		ftp,
		compact = false,
		tv = false,
		targetLabel = 'target',
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
	} = $props();

	const pct = (w: number) => fillPct(w, ftp);
	const state = $derived(targetState({ watts, target }));
	const zone = $derived(zoneOf(watts, ftp));
</script>

{#snippet track(height: string)}
	<div class="relative {height}">
		<div
			class="bg-surface-raised absolute inset-0 overflow-hidden rounded-full"
		>
			{#if state.has}
				<!-- The slot you are aiming at. -->
				<div
					class="bg-neon/30 absolute inset-y-0"
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
				style="width: {pct(watts)}%"
			>
				<div class="{ZONE_BG[zone]} h-full w-full"></div>
			</div>
			{#if state.has}
				<div
					class="bg-neon absolute inset-y-0 w-1"
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
				class="font-display text-watt glow-text-strong text-4xl leading-none font-bold tabular-nums"
				>{watts}</span
			>
			<span class="eyebrow">w</span>
		</span>
		<span class="min-w-0 flex-1">{@render track('h-3')}</span>
		<span
			class="shrink-0 text-xs tabular-nums {state.inBand
				? 'text-z4'
				: 'text-muted'}"
			>{state.has ? `${targetLabel} ${target} W` : 'no target'}</span
		>
	</div>
{:else}
	<div class="relative {tv ? 'h-[22vh]' : 'h-28'}">
		<div
			class="absolute bottom-0 -translate-x-1/2 text-center transition-[left] duration-500 ease-out"
			style="left: clamp({tv ? '10vh' : '5rem'}, {pct(watts)}%, calc(100% - {tv
				? '10vh'
				: '5rem'}))"
		>
			<span
				class="font-display text-watt glow-text-strong block leading-[0.85] font-bold tabular-nums {tv
					? 'text-[16vh]'
					: 'text-[6.5rem]'}">{watts}</span
			>
			<span class="eyebrow {tv ? 'text-[1.6vh]' : ''}">watts</span>
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
			{#if !state.has}
				no {targetLabel} — spin easy
			{:else if state.inBand}
				on {targetLabel} · {target} W
			{:else}
				{state.delta > 0 ? '+' : ''}{state.delta} W · aim for {target}
			{/if}
		</span>
		<span>{Math.round(ftp * 1.5)}</span>
	</div>
{/if}
