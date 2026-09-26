<script lang="ts">
	// Questions riders actually ask, answered in the page's own text (#2995).
	// No FAQPage markup: Google dropped the rich result in 2026, and what AI
	// answers quote is the visible words. A disclosure needs no script.
	let {
		items,
		heading = 'Questions',
	}: { items: { q: string; a: string }[]; heading?: string } = $props();
</script>

<section class="mx-auto w-full max-w-3xl px-4 sm:px-6">
	<h2 class="font-display text-3xl font-bold tracking-tight">{heading}</h2>
	<div class="mt-6 flex flex-col gap-2">
		{#each items as item (item.q)}
			<details class="panel group">
				<summary
					class="font-display cursor-pointer list-none py-1 font-bold [&::-webkit-details-marker]:hidden"
				>
					<span
						class="text-neon mr-2 inline-block transition-transform group-open:rotate-45"
						>+</span
					>{item.q}
				</summary>
				<p class="text-muted mt-2 pb-1 text-sm leading-relaxed">{item.a}</p>
			</details>
		{/each}
	</div>
</section>
