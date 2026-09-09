<script lang="ts">
	// rpm, bpm, w/kg and the bias trim. Glanced at, never hunted for — so no
	// boxes. Bias keeps thumb-sized targets whatever else shrinks: it is the
	// one control a rider reaches for mid-interval (ux.md).
	import { wkg } from '$lib/format';
	import { hrZoneOf, ZONE_TEXT } from '$lib/components/zones';
	import Heart from '@lucide/svelte/icons/heart';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Scale from '@lucide/svelte/icons/scale';
	import Target from '@lucide/svelte/icons/target';

	// Primitives, not a RoomRider: the solo ride and the ramp test have these
	// numbers without a roster to belong to.
	let {
		cadence,
		hr,
		watts,
		kg,
		bias,
		lthr,
		execution,
		small = false,
		onBias,
	}: {
		cadence: number;
		hr: number;
		watts: number;
		kg: number;
		/** The ERG trim. Absent where there is no target to trim — a phone
		 *  spectator reads someone else's numbers and rides nothing (#412). */
		bias?: number;
		/** Your LTHR, for your OWN bpm's zone colour (ADR-0014) — never
		 *  somebody else's readout, so a follower passes none. */
		lthr?: number;
		/** Your live score, where nothing else ranks it (ADR-0046): solo and the
		 *  ramp have no ExecutionMeter to put it in. 0–1. */
		execution?: number;
		small?: boolean;
		/** Absent with no trainer paired: nothing to trim (ux.md gating). */
		onBias?: (step: number) => void;
	} = $props();

	// bpm appears only when something is actually reporting it: a permanent
	// "0 bpm" is worse than no cell, because it reads as a broken strap rather
	// than as no strap. The solo ride made that call in #1057 and it survives
	// the move onto this row (ADR-0046).

	// A dead control with no reason reads as a broken feature — riders report
	// "bias does nothing" when what is missing is the trainer it trims (#565).
	const NO_TRAINER = 'Pair a trainer — bias trims the target it holds';
</script>

<div class="flex items-center gap-6">
	<!-- An icon per instrument (#1531): at three metres a glyph is found before
	     a three-letter label is read, and the rider asked for exactly that. -->
	{#each [{ label: 'rpm', value: `${cadence}`, tone: '', icon: RefreshCw }, ...(hr > 0 ? [{ label: 'bpm', value: `${hr}`, tone: lthr ? ZONE_TEXT[hrZoneOf(hr, lthr)] : '', icon: Heart }] : []), { label: 'w/kg', value: wkg(watts, kg), tone: '', icon: Scale }, ...(execution !== undefined ? [{ label: 'execution', value: `${Math.round(execution * 100)}%`, tone: '', icon: Target }] : [])] as stat (stat.label)}
		<div class="shrink-0">
			<span
				class="font-display block leading-none font-bold tabular-nums {small
					? 'text-lg'
					: 'text-3xl'} {stat.tone}">{stat.value}</span
			>
			<span class="eyebrow mt-0.5 flex items-center gap-1">
				<stat.icon size={small ? 10 : 12} aria-hidden="true" />{stat.label}
			</span>
		</div>
	{/each}
	{#if bias !== undefined}
		<div class="ml-auto flex shrink-0 items-center gap-2">
			<button
				onclick={() => onBias?.(-0.01)}
				disabled={!onBias}
				title={onBias ? 'Ease the target by one percent' : NO_TRAINER}
				class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded-full border text-lg disabled:opacity-40"
				aria-label="ease the target by one percent">−</button
			>
			<span class="text-center">
				<span
					class="font-display block text-lg leading-none font-bold tabular-nums"
					>{Math.round(bias * 100)}%</span
				>
				<span class="eyebrow">bias</span>
			</span>
			<button
				onclick={() => onBias?.(0.01)}
				disabled={!onBias}
				title={onBias ? 'Raise the target by one percent' : NO_TRAINER}
				class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded-full border text-lg disabled:opacity-40"
				aria-label="raise the target by one percent">+</button
			>
		</div>
	{/if}
</div>
