<script lang="ts">
	// The ERG trim, beside the bike computer rather than on one of its pages:
	// it is the one control a rider reaches for mid-interval, so turning a
	// page must never hide it, and it keeps thumb-sized targets (ux.md).
	let {
		bias,
		onBias,
		hint,
	}: {
		bias: number;
		/** Absent with no trainer paired: nothing to trim (ux.md gating). */
		onBias?: (step: number) => void;
		/**
		 * Why the trim is off, when the reason is not the usual one (#2075) —
		 * a screen that holds the trainer but does not drive it has one
		 * paired, and "pair a trainer" would send the rider to look for a
		 * problem that is not there.
		 */
		hint?: string;
	} = $props();

	// A dead control with no reason reads as a broken feature — riders report
	// "bias does nothing" when what is missing is the trainer it trims (#565).
	const NO_TRAINER = 'Pair a trainer — bias trims the target it holds';
	const off = $derived(hint ?? NO_TRAINER);
</script>

<div class="flex shrink-0 items-center gap-2">
	<button
		onclick={() => onBias?.(-0.01)}
		disabled={!onBias}
		title={onBias ? 'Ease the target by one percent' : off}
		class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded-full border text-lg disabled:opacity-40"
		aria-label="ease the target by one percent">−</button
	>
	<span class="text-center">
		<span class="num block text-lg leading-none font-bold"
			>{Math.round(bias * 100)}%</span
		>
		<span class="eyebrow">bias</span>
	</span>
	<button
		onclick={() => onBias?.(0.01)}
		disabled={!onBias}
		title={onBias ? 'Raise the target by one percent' : off}
		class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded-full border text-lg disabled:opacity-40"
		aria-label="raise the target by one percent">+</button
	>
</div>
