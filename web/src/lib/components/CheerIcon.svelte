<script lang="ts">
	import { iconFor } from '$lib/icons';

	// One reaction from the room's palette (#223), drawn from its key — or
	// from the emoji an older client threw (#447). The accessible name is the
	// caller's: a button holding this labels itself with the key.
	let {
		cheer,
		size = 16,
		class: cls = '',
	}: { cheer: string; size?: number; class?: string } = $props();

	const Icon = $derived(iconFor(cheer));
</script>

{#if Icon}
	<Icon {size} class="shrink-0 {cls}" aria-hidden="true" />
{/if}
