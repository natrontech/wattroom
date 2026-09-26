<script lang="ts">
	// A screenshot of the real app (`make screenshots` writes them), framed
	// like a window so it reads as the product and not as decoration. Width
	// and height are given so the page does not jump when it arrives.
	let {
		name,
		alt,
		caption,
		width = 1280,
		height = 800,
		eager = false,
		narrow = false,
	}: {
		name: string;
		alt: string;
		caption?: string;
		width?: number;
		height?: number;
		eager?: boolean;
		/** A portrait shot — a panel or a phone — held to a phone's width. */
		narrow?: boolean;
	} = $props();
</script>

<figure class={narrow ? 'mx-auto w-full max-w-72' : ''}>
	<div
		class="border-muted/20 bg-surface-raised overflow-hidden rounded-xl border shadow-2xl"
	>
		<img
			src="/screens/{name}.webp"
			{alt}
			{width}
			{height}
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			class="block h-auto w-full"
		/>
	</div>
	{#if caption}
		<figcaption class="text-muted mt-3 text-center text-sm">
			{caption}
		</figcaption>
	{/if}
</figure>
