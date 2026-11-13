<script lang="ts">
	/**
	 * A closing card's pictures for Strava (#4221): the poster, drawn by the
	 * server from the saved ride, and the world's two, taken on the ride: you,
	 * and the same moment from above (#4431). The rider saves any of them;
	 * Strava's API takes the activity and never a photo, so these are what a
	 * rider adds by hand.
	 */
	import { cardLabel } from '#lib/ride/card.ts';
	import RideCardChooser from '#lib/ride/RideCardChooser.svelte';
	import WorldPicture from '#lib/ride/WorldPicture.svelte';

	let { rideId }: { rideId?: string } = $props();

	let choosing = $state(false);
</script>

{#if rideId}
	<button
		onclick={() => (choosing = true)}
		data-testid="download-card"
		class="btn btn-secondary">{cardLabel({})}</button
	>
	{#if choosing}
		<RideCardChooser
			{rideId}
			label={cardLabel({})}
			onclose={() => (choosing = false)}
		/>
	{/if}
{/if}
<WorldPicture {rideId} />
