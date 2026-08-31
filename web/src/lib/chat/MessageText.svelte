<script lang="ts">
	import { parseInline } from './inline';
	import LinkPreview from './LinkPreview.svelte';

	let { text, preview = true }: { text: string; preview?: boolean } = $props();

	const parts = $derived(parseInline(text, location.origin));

	const marks = (part: {
		bold?: boolean;
		italic?: boolean;
		strike?: boolean;
	}) =>
		[
			part.bold ? 'font-semibold' : '',
			part.italic ? 'italic' : '',
			part.strike ? 'line-through' : '',
		]
			.filter(Boolean)
			.join(' ');
</script>

{#each parts as part, i (i)}{#if part.href}<a
			href={part.href}
			target={part.external ? '_blank' : null}
			rel={part.external ? 'noopener noreferrer' : null}
			class="text-neon decoration-neon/40 hover:decoration-neon break-all underline"
			>{part.text}</a
		>{:else if part.code}<code
			class="bg-surface-raised text-ink/90 rounded px-1 py-0.5 font-mono text-[0.95em]"
			>{part.text}</code
		>{:else}<span class={marks(part)}>{part.text}</span
		>{/if}{/each}{#if preview}<LinkPreview {parts} />{/if}
