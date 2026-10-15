<script lang="ts">
	import type { Snippet } from 'svelte';

	// A finished ride's header (#3686): the eyebrow over the title, and the
	// ride's actions on the same row — never last, below the fold. The ride
	// page wears it too (#3687). Every action is 44 px tall here, whatever
	// button the call site hands in.
	let {
		eyebrow,
		title,
		titleHref,
		subline,
		actions,
	}: {
		/** “<weekday> · <ride kind> · Solo|<crew>” (`recapEyebrow`). */
		eyebrow: string;
		title: string;
		/** The title opens this page (a road's route page, F1). */
		titleHref?: string;
		/** A muted line under the title, before the actions wrap. */
		subline?: Snippet;
		/** Secondary actions first; the one filled button, Done, last. */
		actions?: Snippet;
	} = $props();
</script>

<header class="flex flex-wrap items-center gap-x-6 gap-y-3">
	<div class="min-w-0">
		<p class="eyebrow">{eyebrow}</p>
		<h1 class="page-title-sm mt-1 leading-tight break-words">
			{#if titleHref}
				<a href={titleHref} class="underline decoration-1 underline-offset-4"
					>{title}</a
				>
			{:else}
				{title}
			{/if}
		</h1>
		{#if subline}
			<p class="text-muted mt-1 text-xs">{@render subline()}</p>
		{/if}
	</div>
	{#if actions}
		<div
			data-testid="recap-actions"
			class="flex w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto [&_.btn]:min-h-11"
		>
			{@render actions()}
		</div>
	{/if}
</header>
