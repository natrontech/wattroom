<script lang="ts">
	/**
	 * One of the first world ride's three marks (#3218), in the moment card's
	 * place over the world: a label, an "x of y" and one button (TARGETS G4:
	 * every word on a riding surface is a label or a number). A sprint takes
	 * the place back; "?" in slot 1 puts the marks away. Ink and violet
	 * chrome, no watt, no glow (ADR-0005).
	 */
	import { COACH_MARKS } from '$lib/ride/coach-marks';

	let {
		step,
		onnext,
		ondone,
	}: { step: number; onnext: () => void; ondone: () => void } = $props();

	const last = $derived(step === COACH_MARKS.length - 1);
</script>

<div
	data-testid="coach-mark"
	class="flex max-w-full min-w-[300px] flex-col gap-2 rounded-[11px] px-4 py-3"
>
	<p class="ride-label">{COACH_MARKS[step]}</p>
	<div class="flex items-center justify-between gap-2">
		<span class="ride-label num">{step + 1} of {COACH_MARKS.length}</span>
		<button onclick={last ? ondone : onnext} class="btn btn-secondary btn-ride"
			>{last ? 'Got it' : 'Next'}</button
		>
	</div>
</div>
