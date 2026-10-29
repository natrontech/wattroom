<script lang="ts">
	// The channel's ride place while you are in no session (#2449): the free
	// ride (ADR-0059) — set the watts or the grade, ride, save. A session
	// opening here leaves you on it and offers the way in; only the rider who
	// starts one moves to its address (#2450, SessionLayers). A phone cannot
	// ride, so it keeps the Training place's words.
	import { page } from '$app/state';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { device } from '$lib/device.svelte';
	import FreeRide from '$lib/ride/FreeRide.svelte';
	import OwnRide from '$lib/ride/OwnRide.svelte';
	import TheRide from '$lib/ride/TheRide.svelte';
	import { theRide } from '$lib/ride/the-ride.svelte';
	import Training from '$lib/session/Training.svelte';
</script>

<!-- The ride you started alone runs on here (ADR-0093): the device has one
     ride, and this is one of the screens that draws it, never a second Start.
     Your own workout, once picked, takes the place of the free ride until you
     are back from its summary (#2329). -->
{#if theRide.session}
	<div class="flex min-h-full flex-col px-4 py-5 sm:px-6">
		<TheRide doneHref="/crew/{page.params.id}/v/{page.params.channel}" />
	</div>
{:else if device.spectator}
	<Training />
{:else if channelConnection.current?.ownRide.session}
	<OwnRide />
{:else}
	<FreeRide />
{/if}
