<script lang="ts">
	import { X } from '@lucide/svelte';

	// The picture about to be sent, with the one way out (#279). Nothing
	// while there is none, so a composer can always render it.
	let {
		image,
		onClear,
	}: {
		image: { preview: string } | null;
		onClear: () => void;
	} = $props();
</script>

{#if image}
	<div class="relative mb-2 inline-block">
		<img
			src={image.preview}
			alt="Ready to send"
			class="ring-ink/10 max-h-24 rounded ring-1"
		/>
		<button
			onclick={onClear}
			class="bg-surface-raised ring-ink/10 text-muted hover:text-ink absolute -top-1.5 -right-1.5 rounded-full p-0.5 ring-1"
			aria-label="Remove image"><X size={12} /></button
		>
	</div>
{/if}
