<script lang="ts">
	import { iconFor } from '$lib/icons';

	// A crew's identity mark (#223), drawn from its stored key (#447).
	// Nothing for a crew without one — the name stands alone.
	let {
		icon,
		size = 14,
		class: cls = '',
	}: { icon: string | undefined; size?: number; class?: string } = $props();

	const Icon = $derived(iconFor(icon));
</script>

{#if Icon}
	<Icon {size} class="shrink-0 {cls}" aria-hidden="true" />
{/if}
