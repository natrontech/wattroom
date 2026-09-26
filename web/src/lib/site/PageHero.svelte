<script lang="ts">
	import type { Snippet } from 'svelte';

	// A keyword page's opening (#2995): the query it answers as an eyebrow,
	// the answer as the h1, and the way in. The h1 is the page's largest
	// paint, and it is text in the prerendered HTML.
	let {
		eyebrow,
		title,
		lede,
		children,
	}: { eyebrow: string; title: string; lede: string; children?: Snippet } =
		$props();
</script>

<section
	class="mx-auto w-full max-w-4xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24"
>
	<p class="eyebrow mb-4">{eyebrow}</p>
	<h1
		class="font-display text-4xl leading-[1.02] font-bold tracking-tight text-balance uppercase sm:text-6xl"
	>
		{title}
	</h1>
	<p
		class="text-muted mx-auto mt-5 max-w-2xl text-base text-balance sm:text-lg"
	>
		{lede}
	</p>
	<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
		{#if children}
			{@render children()}
		{:else}
			<a href="/login" class="btn btn-primary btn-lg">Start your crew</a>
			<a href="/" class="btn btn-secondary btn-lg">What is WattRoom?</a>
		{/if}
	</div>
</section>
