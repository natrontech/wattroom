<script lang="ts">
	import type { Part } from './inline';
	import { cardLink, holdCard, type Card } from './unfurl';

	// Every link gets a card now (#866, ADR-0031) — YouTube and Spotify from
	// their own oEmbed, everything else from the server, which is the only
	// thing allowed to read a page that is not ours. `unfurl.ts` owns which
	// is which and when a card may land (#3734); this draws the result.

	let { parts }: { parts: Part[] } = $props();

	const url = $derived(cardLink(parts));
	let card = $state<Card | null>(null);
	let marker = $state<HTMLElement>();

	$effect(() => {
		card = null;
		const line = marker?.parentElement;
		if (!url || !line) return;
		return holdCard(
			url,
			(fresh) => (card = fresh),
			(then) => {
				const watch = new IntersectionObserver(([entry]) => {
					if (!entry.isIntersecting) then();
				});
				watch.observe(line);
				return () => watch.disconnect();
			},
		);
	});
</script>

<!-- No placeholder (#3734): the line is drawn bare and grows by its card at
     most once, never shrinks. A skeleton held the card's box (#2686), but a
     link with nothing to show gave it back seconds later and moved the
     thread anyway. `whitespace-normal`: the line around it is pre-wrap
     (#2642), which drew the template's own spaces between the card's rows
     as blank lines. -->
<span bind:this={marker} hidden></span>{#if card && url}
	<span class="mt-1 flex max-w-sm items-stretch gap-1 whitespace-normal">
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			class="border-ink/10 hover:border-neon/40 bg-surface-raised flex h-14 min-w-0 flex-1 items-center gap-2 rounded border p-1.5"
		>
			{#if card.thumb}
				<img
					src={card.thumb}
					alt=""
					loading="lazy"
					class="h-9 w-16 shrink-0 rounded object-cover"
				/>
			{/if}
			<span class="min-w-0">
				<span class="text-ink/85 block truncate text-[11px] leading-tight"
					>{card.title}</span
				>
				{#if card.description}
					<!-- One line: the card is a hint about where the link goes, not
					     the article. -->
					<span class="text-muted-dim block truncate text-[10px] leading-tight"
						>{card.description}</span
					>
				{/if}
				<span class="text-muted-dim block truncate font-mono text-[10px]"
					>{card.siteName || card.host}</span
				>
			</span>
		</a>
	</span>
{/if}
