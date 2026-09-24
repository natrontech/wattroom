<script lang="ts">
	// A textarea cannot draw a picture: a draft that names a crew emoji reads
	// here as the line will, so `:party_parrot:` in the box is not all the
	// rider sees of it — writing a line, and rewriting one.
	import { crewEmoji, emojiCrew } from '$lib/emoji/crew-emoji.svelte';
	import { parseInline } from './inline';
	import MessageText from './MessageText.svelte';

	let { text }: { text: string } = $props();

	const crew = emojiCrew();
	const draws = $derived.by(() => {
		const id = crew();
		return (
			!!id &&
			parseInline(text, '').some((p) => p.emoji && crewEmoji.url(id, p.emoji))
		);
	});
</script>

{#if draws}
	<!-- The box already says it to a screen reader; this is its picture. -->
	<p
		class="text-muted mt-1 line-clamp-3 text-xs whitespace-pre-wrap"
		aria-hidden="true"
		data-testid="draft-emoji"
	>
		<MessageText {text} preview={false} />
	</p>
{/if}
