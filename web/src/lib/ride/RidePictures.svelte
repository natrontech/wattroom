<script lang="ts">
	/**
	 * A closing card's two pictures for Strava (#4221): the poster, drawn by
	 * the server from the saved ride, and the world's, taken on the ride. The
	 * rider saves either or both; Strava's API takes the activity and never a
	 * photo, so these are what a rider adds by hand.
	 */
	import { downloadRideCard } from '$lib/ride/card';
	import { toasts } from '$lib/toast.svelte';
	import WorldPicture from '$lib/ride/WorldPicture.svelte';

	let { rideId }: { rideId?: string } = $props();

	let drawing = $state(false);
	async function poster(id: string) {
		drawing = true;
		const message = await downloadRideCard(id);
		drawing = false;
		if (message) toasts.push(message, { tone: 'error' });
	}
</script>

{#if rideId}
	{@const id = rideId}
	<button
		onclick={() => void poster(id)}
		disabled={drawing}
		data-testid="download-card"
		class="btn btn-secondary">{drawing ? 'Drawing…' : 'Ride card'}</button
	>
{/if}
<WorldPicture />
