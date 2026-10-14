<script lang="ts">
	import type { Snippet } from 'svelte';

	// A finished ride's header (#3686): the eyebrow over the title, and the
	// ride's actions on the same row — never last, below the fold. The ride
	// page wears it too (#3687). Every action is 44 px tall here, whatever
	// button the call site hands in.
	let {
		eyebrow,
		title,
		actions,
	}: {
		/** “<weekday> · <ride kind> · Solo|<crew>” (`recapEyebrow`). */
		eyebrow: string;
		title: string;
		/** Secondary actions first; the one filled button, Done, last. */
		actions?: Snippet;
	} = $props();
</script>

<header class="flex flex-wrap items-center gap-x-6 gap-y-3">
	<div class="min-w-0">
		<p class="eyebrow">{eyebrow}</p>
		<h1 class="page-title-sm mt-1 leading-tight break-words">{title}</h1>
	</div>
	{#if actions}
		<div
			data-testid="recap-actions"
			class="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end [&_.btn]:min-h-11"
		>
			{@render actions()}
		</div>
	{/if}
</header>
