<script lang="ts">
	import { parseInline } from './inline';
	import { gifUrl } from './media';
	import ChatImage from './ChatImage.svelte';
	import LinkPreview from './LinkPreview.svelte';

	let {
		text,
		preview = true,
		onQueue,
	}: {
		text: string;
		preview?: boolean;
		onQueue?: (url: string) => void;
	} = $props();

	// A message that is nothing but an allowlisted GIF link becomes the GIF
	// (#279) — the same "show it, don't link it" rule LinkPreview follows, for
	// the one media type worth playing inline. `preview={false}` surfaces
	// (the phone spectator) keep the plain link.
	const gif = $derived(preview ? gifUrl(text) : null);

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

{#if gif}<ChatImage
		src={gif}
		alt="GIF"
	/>{:else}{#each parts as part, i (i)}{#if part.href}<a
				href={part.href}
				target={part.external ? '_blank' : null}
				rel={part.external ? 'noopener noreferrer' : null}
				class="text-neon decoration-neon/40 hover:decoration-neon break-all underline"
				>{part.text}</a
			>{:else if part.code}<code
				class="bg-surface-raised text-ink/90 rounded px-1 py-0.5 font-mono text-[0.95em]"
				>{part.text}</code
			>{:else}<span class={marks(part)}>{part.text}</span
			>{/if}{/each}{#if preview}<LinkPreview {parts} {onQueue} />{/if}{/if}
