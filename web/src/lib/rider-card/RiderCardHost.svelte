<script lang="ts">
	// The one rider card (#2739), the way ContextMenuHost is the one menu.
	// Anything that moves the face out from under it — a new page, a scroll,
	// Escape — takes the card with it.
	import { page } from '$app/state';
	import RiderCard from './RiderCard.svelte';
	import { riderCard } from './rider-card.svelte';

	$effect(() => {
		void page.url.pathname;
		riderCard.close();
	});
	$effect(() => {
		if (!riderCard.current) return;
		const close = () => riderCard.close();
		window.addEventListener('scroll', close, true);
		return () => window.removeEventListener('scroll', close, true);
	});
</script>

<svelte:window
	onkeydown={(event) => event.key === 'Escape' && riderCard.close()}
/>

{#if riderCard.current}
	{#key riderCard.current.id}
		<RiderCard id={riderCard.current.id} anchor={riderCard.current.anchor} />
	{/key}
{/if}
