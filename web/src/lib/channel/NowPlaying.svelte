<script lang="ts">
	// What is on the deck, directly under the player's seat on a riding
	// screen, at its width (TARGETS ride-session-road 3).
	import { channelConnection } from '#lib/channel/connection.svelte.ts';

	const current = $derived(channelConnection.call?.live.tick?.jukebox?.current);
</script>

{#if current}
	<p class="truncate py-1 text-2xl leading-7">
		{current.title} · <span class="text-muted">{current.addedBy}</span>
	</p>
{/if}
