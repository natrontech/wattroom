<script lang="ts">
	import type { Snippet } from 'svelte';

	// Empty states teach, never apologize (ux.md): one line on what the thing
	// is, plus the CTA that creates the first one.
	//
	// Two variants, one API: `inline` is the dashed box that sits inside a
	// list or section (history, trophies); `page` fills the whole content
	// area with no border, for a place whose primary content just isn't
	// picked yet (messages with no thread selected).
	let {
		children,
		cta,
		icon,
		variant = 'inline',
	}: {
		children: Snippet;
		cta?: Snippet;
		icon?: Snippet;
		variant?: 'inline' | 'page';
	} = $props();
</script>

{#if variant === 'page'}
	<div class="text-muted grid flex-1 place-items-center px-6 text-center">
		<div class="max-w-sm">
			{#if icon}<div class="mx-auto">{@render icon()}</div>{/if}
			{@render children()}
			{#if cta}<div class="mt-3">{@render cta()}</div>{/if}
		</div>
	</div>
{:else}
	<div
		class="border-muted/25 text-muted rounded-lg border border-dashed px-5 py-8 text-center text-sm"
	>
		{#if icon}<div class="mb-2 flex justify-center">{@render icon()}</div>{/if}
		<div>{@render children()}</div>
		{#if cta}<div class="mt-3">{@render cta()}</div>{/if}
	</div>
{/if}
