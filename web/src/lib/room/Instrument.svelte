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
	import { targetState, type RoomRider } from '$lib/room/view';
	import { wkg } from '$lib/format';

	let {
		you,
		compact = false,
		targetLabel = 'target',
	}: {
		you: RoomRider;
		/** Collapsed to a single bar — what it becomes under a shared player. */
		compact?: boolean;
		/** The ramp test prescribes a step, not a target. */
		targetLabel?: string;
	} = $props();

	const pct = (w: number) => fillPct(w, you.ftp);
	const state = $derived(targetState(you));
	const zone = $derived(zoneOf(you.watts, you.ftp));
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
					style="left: {pct(you.target - state.band)}%; width: {pct(
						you.target + state.band,
					) - pct(you.target - state.band)}%"
				></div>
			{/if}
			<!-- Literal zone class: Tailwind scans source text, so a composed
			     `bg-z3/60` is never generated (zones.ts). Full strength — the ramp
			     is contrast-gated at 3:1 and dimming it voids that. -->
			<div
				class="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
				style="width: {pct(you.watts)}%"
			>
				<div class="{ZONE_BG[zone]} h-full w-full"></div>
			</div>
			{#if state.has}
				<div
					class="bg-neon absolute inset-y-0 w-1"
					style="left: {pct(you.target)}%"
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
				>{you.watts}</span
			>
			<span class="eyebrow">w</span>
		</span>
		<span class="min-w-0 flex-1">{@render track('h-3')}</span>
		<span
			class="shrink-0 text-xs tabular-nums {state.inBand
				? 'text-z4'
				: 'text-muted'}"
			>{state.has ? `${targetLabel} ${you.target} W` : 'no target'}</span
		>
	</div>
{:else}
	<div class="relative h-28">
		<div
			class="absolute bottom-0 -translate-x-1/2 text-center transition-[left] duration-500 ease-out"
			style="left: clamp(5rem, {pct(you.watts)}%, calc(100% - 5rem))"
		>
			<span
				class="font-display text-watt glow-text-strong block text-[6.5rem] leading-[0.85] font-bold tabular-nums"
				>{you.watts}</span
			>
			<span class="eyebrow">watts</span>
		</div>
	</div>

	<div class="mt-3">{@render track('h-12')}</div>

	<div class="text-muted mt-2 flex items-baseline text-xs tabular-nums">
		<span>0</span>
		<span
			class="mx-auto text-sm {state.inBand
				? 'text-z4'
				: state.delta > 0
					? 'text-z5'
					: 'text-muted'}"
		>
			{#if !state.has}
				no {targetLabel} — spin easy
			{:else if state.inBand}
				on {targetLabel} · {you.target} W
			{:else}
				{state.delta > 0 ? '+' : ''}{state.delta} W · aim for {you.target}
			{/if}
		</span>
		<span>{Math.round(you.ftp * 1.5)}</span>
	</div>
{/if}
