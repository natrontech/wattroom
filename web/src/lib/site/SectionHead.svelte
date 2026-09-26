<script lang="ts">
	// A section's eyebrow, heading and one line of why (#2995).
	let {
		eyebrow,
		title,
		lede,
		center = false,
	}: {
		eyebrow?: string;
		title: string;
		lede?: string;
		center?: boolean;
	} = $props();
</script>

<div class={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
	{#if eyebrow}<p class="eyebrow mb-3">{eyebrow}</p>{/if}
	<h2
		class="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl"
	>
		{title}
	</h2>
	{#if lede}<p class="text-muted mt-3 text-base text-balance">{lede}</p>{/if}
</div>
