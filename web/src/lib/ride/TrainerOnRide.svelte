<script lang="ts">
	/**
	 * One ride per device (ADR-0093): while your ride alone runs, the trainer
	 * is its, and pairing one beside it would give the hardware two masters.
	 * Said in place of a trainer card, with the way back to the ride.
	 */
	let {
		then,
	}: {
		/** What ending the ride lets the rider do here. */
		then: string;
	} = $props();
</script>

<p class="text-muted text-xs">
	Your trainer is on your ride. End it to {then}.
	<a href="/ride" class="btn-link">Open your ride</a>
</p>
