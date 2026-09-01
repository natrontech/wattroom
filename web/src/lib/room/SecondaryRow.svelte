<script lang="ts">
	// rpm, bpm, w/kg and the bias trim. Glanced at, never hunted for — so no
	// boxes. Bias keeps thumb-sized targets whatever else shrinks: it is the
	// one control a rider reaches for mid-interval (ux.md).
	import { wkg } from '$lib/format';
	import type { RoomRider } from '$lib/room/view';

	let {
		you,
		bias,
		small = false,
		onBias,
	}: {
		you: RoomRider;
		bias: number;
		small?: boolean;
		/** Absent with no trainer paired: nothing to trim (ux.md gating). */
		onBias?: (step: number) => void;
	} = $props();
</script>

<div class="flex items-center gap-6">
	{#each [{ label: 'rpm', value: `${you.cadence}` }, { label: 'bpm', value: `${you.hr}` }, { label: 'w/kg', value: wkg(you.watts, you.kg) }] as stat (stat.label)}
		<div class="shrink-0">
			<span
				class="font-display block leading-none font-bold tabular-nums {small
					? 'text-lg'
					: 'text-2xl'}">{stat.value}</span
			>
			<span class="eyebrow">{stat.label}</span>
		</div>
	{/each}
	<div class="ml-auto flex shrink-0 items-center gap-2">
		<button
			onclick={() => onBias?.(-0.01)}
			disabled={!onBias}
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
			class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded-full border text-lg disabled:opacity-40"
			aria-label="raise the target by one percent">+</button
		>
	</div>
</div>
