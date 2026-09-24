<script lang="ts">
	// A rider's status line beside their name (ADR-0060): the emoji, the words
	// on hover — or, with `text`, the words beside it. A crew emoji is its
	// picture while it exists and its :name: once the crew deleted it; a line
	// with words and no emoji draws a speech bubble, as Slack does.
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import type { StatusLine } from '$lib/protocol';

	let {
		line,
		size = 14,
		text = false,
	}: {
		line: StatusLine | null | undefined;
		size?: number;
		/** The words beside the emoji, not only on hover. */
		text?: boolean;
	} = $props();

	// The server stops sending a line once it clears; a feed polled a minute
	// ago may still hold one, so a render past its time draws nothing.
	const shown = $derived(
		line && !(line.expiresAt && Date.parse(line.expiresAt) <= Date.now())
			? line
			: null,
	);
</script>

{#if shown}
	<span
		class="inline-flex min-w-0 items-center gap-1 align-middle"
		title={[shown.emoji, shown.text].filter(Boolean).join(' ')}
		data-testid="status-line"
	>
		{#if shown.emojiId}
			<img
				src="/api/emoji/{shown.emojiId}"
				alt={shown.emoji}
				width={size}
				height={size}
				class="shrink-0 object-contain"
			/>
		{:else if shown.emoji?.startsWith(':')}
			<span class="text-muted max-w-[8em] shrink-0 truncate text-[0.85em]"
				>{shown.emoji}</span
			>
		{:else if shown.emoji}
			<span class="shrink-0 leading-none" style:font-size="{size}px"
				>{shown.emoji}</span
			>
		{:else}
			<MessageCircle {size} class="text-muted shrink-0" aria-hidden="true" />
		{/if}
		{#if shown.text}
			<span class={text ? 'truncate' : 'sr-only'}>{shown.text}</span>
		{/if}
	</span>
{/if}
