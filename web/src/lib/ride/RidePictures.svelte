<script lang="ts">
	/**
	 * A closing card's two pictures for Strava (#4221): the poster, drawn by
	 * the server from the saved ride, and the world's, taken on the ride. The
	 * rider saves either or both; Strava's API takes the activity and never a
	 * photo, so these are what a rider adds by hand.
	 */
	import RideCardChooser from '$lib/ride/RideCardChooser.svelte';
	import WorldPicture from '$lib/ride/WorldPicture.svelte';

	let { rideId }: { rideId?: string } = $props();

	let choosing = $state(false);
</script>

{#if rideId}
	<button
		onclick={() => (choosing = true)}
		data-testid="download-card"
		class="btn btn-secondary">Ride card</button
	>
	{#if choosing}
		<RideCardChooser
			{rideId}
			label="Download the ride card"
			onclose={() => (choosing = false)}
		/>
	{/if}
{/if}
<WorldPicture />
