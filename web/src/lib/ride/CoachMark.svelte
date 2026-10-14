<script lang="ts">
	/**
	 * One of the first world ride's three marks (#3218), in the moment card's
	 * place over the world: a sprint takes the place back. Ink and violet
	 * chrome, no watt, no glow (ADR-0005).
	 */
	import { COACH_MARKS } from '$lib/ride/coach-marks';

	let {
		step,
		onnext,
		ondone,
	}: { step: number; onnext: () => void; ondone: () => void } = $props();

	const mark = $derived(COACH_MARKS[step]);
	const last = $derived(step === COACH_MARKS.length - 1);
</script>

<div
	data-testid="coach-mark"
	class="flex max-w-full min-w-[300px] flex-col gap-2 rounded-[11px] px-4 py-3"
>
	<p class="ride-label">
		how to read the road · {step + 1} of {COACH_MARKS.length}
	</p>
	<p class="text-2xl leading-7 font-bold">{mark.title}</p>
	<p class="text-base">{mark.body}</p>
	<div class="flex justify-end gap-2">
		{#if !last}
			<button onclick={ondone} class="btn btn-ghost btn-ride">Skip</button>
		{/if}
		<button onclick={last ? ondone : onnext} class="btn btn-secondary btn-ride"
			>{last ? 'Got it' : 'Next'}</button
		>
	</div>
</div>
