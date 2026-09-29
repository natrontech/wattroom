<script lang="ts">
	import GlassWater from '@lucide/svelte/icons/glass-water';
	import CheerDeck from '$lib/channel/CheerDeck.svelte';
	import { channelConnection } from '$lib/channel/connection.svelte';

	// The roadside's deck (#3022, ADR-0064): the cheers and the cowbell, and a
	// bottle for the rider you are watching. Paint, sound and information —
	// nothing on it reaches anybody's trainer. The bottle waits on their
	// screen for an easy block, so handing one up mid-interval costs them
	// nothing (roadside.ts).
	let {
		to,
	}: {
		/** Who the bottle goes to — the rider being watched; none, no bottle. */
		to: { id: string; name: string } | null;
	} = $props();

	const live = $derived(channelConnection.current?.live);
</script>

<div class="grid gap-2">
	<CheerDeck onCheer={(key) => live?.cheer(key)} />
	{#if to && live}
		<button
			onclick={() => live.bottle(to.id)}
			class="btn btn-secondary btn-lg w-full"
			><GlassWater size={16} /> Hand {to.name} a bottle</button
		>
	{/if}
</div>
