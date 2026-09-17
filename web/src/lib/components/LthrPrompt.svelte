<script lang="ts">
	let {
		current,
		suggested,
		onApply,
		onKeep,
	}: {
		current: number;
		suggested: number;
		onApply?: () => void;
		onKeep?: () => void;
	} = $props();

	const gain = $derived(Math.round(((suggested - current) / current) * 100));
</script>

<!--
	docs/SPEC.md (#1620): a solo ride of at least 30 minutes with heart rate,
	whose last-20-minute average exceeds the set LTHR by >2 %, prompts with that
	average. Never auto-applied — LTHR moves every heart-rate zone boundary.

	The sentence about the ride being all-out is load-bearing, not padding. The
	rule has no power gate on purpose (a genuine HR field test need not be near
	the rider's best 20-minute power), so nothing in the data distinguishes
	Friel's time trial from a hard group-ride effort. Saying so is what the gate
	would have done, and it is why the rider decides rather than the app.
-->
<div class="border-neon/40 bg-surface-raised rounded-lg border p-5">
	<p class="font-display font-bold">That ride looks like a threshold test</p>
	<p class="text-muted mt-1.5 text-xs leading-relaxed">
		You held <span class="text-ink">{suggested} bpm</span> over the last 20
		minutes of a solo 30-minute ride — {gain}% above the {current} bpm you have set.
		That is the measurement threshold heart rate comes from,
		<em>if you rode it all out</em>. If you were pacing yourself, or riding with
		someone, keep what you have — this can't tell the difference.
	</p>
	<div class="mt-4 flex gap-2">
		<button onclick={onApply} class="btn btn-primary"
			>Set LTHR to {suggested} bpm</button
		>
		<button onclick={onKeep} class="btn btn-secondary"
			>Keep {current} bpm</button
		>
	</div>
</div>
