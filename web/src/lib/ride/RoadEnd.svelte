<script lang="ts">
	/**
	 * The end of a solo route ride's road (#3205): ride back the way you came,
	 * ride it again, or save. Nothing a rider must answer mid-ride goes
	 * without a default (errors.md): Ride back, after RIDE_BACK_AFTER_S.
	 * Mounted while offered (road-end.ts); mounting starts the count.
	 */
	import { play } from '$lib/sound/cues';
	import type { FreeRide } from './free-ride.svelte';
	import { RIDE_BACK_AFTER_S } from './road-end';

	let { free, onsave }: { free: FreeRide; onsave: () => void } = $props();

	let left = $state(RIDE_BACK_AFTER_S);
	$effect(() => {
		play('block');
		const id = setInterval(() => {
			left -= 1;
			if (left <= 0) free.turn('back');
		}, 1000);
		return () => clearInterval(id);
	});
</script>

<section class="panel panel-lg" aria-label="the end of the road">
	<h2 class="font-display text-lg font-bold">The end of the road</h2>
	<p class="text-muted mt-1 text-sm" aria-live="polite">
		Keep pedalling: you ride back the way you came in {Math.max(left, 0)} s.
	</p>
	<div class="mt-3 grid gap-2 sm:grid-cols-3">
		<button onclick={() => free.turn('back')} class="btn btn-primary btn-lg"
			>Ride back the way you came</button
		>
		<button onclick={() => free.turn('again')} class="btn btn-secondary btn-lg"
			>Ride it again</button
		>
		<button onclick={onsave} class="btn btn-secondary btn-lg"
			>Save the ride</button
		>
	</div>
</section>
