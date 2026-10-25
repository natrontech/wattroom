<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The card that pairs a trainer, above a picker's Start while this rider
	 * has none (#2594); `why` finishes "Pair your trainer first".
	 */
	let { trainer, why }: { trainer?: Snippet; why: string } = $props();
</script>

{#if trainer}
	<div class="mb-4">
		<p class="mb-2 text-sm font-medium">Pair your trainer first — {why}.</p>
		{@render trainer()}
	</div>
{/if}
