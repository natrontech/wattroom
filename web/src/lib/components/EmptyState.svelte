<script lang="ts">
	import type { Snippet } from 'svelte';

	// Empty states teach, never apologize (ux.md): one line on what the thing
	// is, plus the CTA that creates the first one.
	let {
		children,
		cta,
	}: {
		children: Snippet;
		cta?: Snippet;
	} = $props();
</script>

<div
	class="border-muted/25 text-muted rounded-lg border border-dashed px-5 py-8 text-center text-sm"
>
	<div>{@render children()}</div>
	{#if cta}<div class="mt-3">{@render cta()}</div>{/if}
</div>
