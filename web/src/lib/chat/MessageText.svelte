<script lang="ts">
	import type { MenuEntry } from '$lib/context-menu.svelte';
	import { crewEmoji, emojiCrew } from '$lib/emoji/crew-emoji.svelte';
	import { parseInline } from './inline';
	import { gifUrl } from './media';
	import ChatImage from './ChatImage.svelte';
	import LinkPreview from './LinkPreview.svelte';

	let {
		text,
		preview = true,
		menu,
	}: {
		text: string;
		preview?: boolean;
		/** The message's menu, handed to a GIF the way ChatImage wants it (#1817). */
		menu?: () => MenuEntry[];
	} = $props();

	// A message that is nothing but an allowlisted GIF link becomes the GIF
	// (#279) — the same "show it, don't link it" rule LinkPreview follows, for
	// the one media type worth playing inline. `preview={false}` surfaces
	// (the phone spectator) keep the plain link.
	const gif = $derived(preview ? gifUrl(text) : null);

	const parts = $derived(parseInline(text, location.origin));

	// A `:name:` the crew knows is its picture (#2643); any other — outside a
	// crew, or a clock like 18:30:00 — stays exactly the text it was.
	const crew = emojiCrew();
	const emojiSrc = (name: string) => {
		const id = crew();
		return id ? crewEmoji.url(id, name) : null;
	};

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

<!-- Rider text — and a changelog line, which is the same component (#2400) —
     carries tokens with no break opportunity: a hash, a column name, a URL
     with no punctuation. `wrap-anywhere` lets one break rather than widen the
     row, and unlike `break-word` it also shrinks the run's min-content width,
     so a flex or grid parent can be narrower than the token. It lives here,
     not on the call sites: MessageThread wraps its own bubble and so was
     safe, /whats-new did not and pushed `page-body` 22px past a 375px phone
     on the release that shipped `wattroom_identities_plaintext_refresh_tokens`. -->
{#if gif}<ChatImage src={gif} alt="GIF" {menu} />{:else}<span
		class="wrap-anywhere"
		>{#each parts as part, i (i)}{#if part.href}<a
					href={part.href}
					target={part.external ? '_blank' : null}
					rel={part.external ? 'noopener noreferrer' : null}
					class="text-neon decoration-neon/40 hover:decoration-neon break-all underline"
					>{part.text}</a
				>{:else if part.code}<code
					class="bg-surface-raised text-ink/90 rounded px-1 py-0.5 font-mono text-[0.95em]"
					>{part.text}</code
				>{:else if part.emoji && emojiSrc(part.emoji)}<img
					src={emojiSrc(part.emoji)}
					alt={part.text}
					title={part.text}
					class="inline-block h-[1.4em] w-auto align-[-0.35em]"
				/>{:else}<span class={marks(part)}>{part.text}</span>{/if}{/each}</span
	>{#if preview}<LinkPreview {parts} />{/if}{/if}
