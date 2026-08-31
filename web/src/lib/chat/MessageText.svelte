<script lang="ts">
	import { linkify } from './linkify';
	import LinkPreview from './LinkPreview.svelte';

	let { text, preview = true }: { text: string; preview?: boolean } = $props();

	const parts = $derived(linkify(text, location.origin));
</script>

{#each parts as part, i (i)}{#if part.href}<a
			href={part.href}
			target={part.external ? '_blank' : null}
			rel={part.external ? 'noopener noreferrer' : null}
			class="text-neon decoration-neon/40 hover:decoration-neon break-all underline"
			>{part.text}</a
		>{:else}{part.text}{/if}{/each}{#if preview}<LinkPreview {parts} />{/if}
