<script lang="ts">
	import X from '@lucide/svelte/icons/x';

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
			class="icon-btn bg-surface-raised ring-ink/10 text-muted hover:text-ink absolute -top-2 -right-2 h-6 w-6 ring-1"
			aria-label="Remove image"><X size={12} /></button
		>
	</div>
{/if}
