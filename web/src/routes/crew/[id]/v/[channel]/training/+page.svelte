<script lang="ts">
	// The channel's ride place while you are in no session (#2449): the free
	// ride (ADR-0059) — set the watts or the grade, ride, save. A session
	// opening here leaves you on it and offers the way in; only the rider who
	// starts one moves to its address (#2450, SessionLayers). A phone cannot
	// ride, so it keeps the Training place's words.
	import { device } from '$lib/device.svelte';
	import FreeRide from '$lib/ride/FreeRide.svelte';
	import Training from '$lib/session/Training.svelte';
</script>

{#if device.spectator}
	<Training />
{:else}
	<FreeRide />
{/if}
