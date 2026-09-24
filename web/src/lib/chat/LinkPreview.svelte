<script lang="ts">
	import Skeleton from '$lib/components/Skeleton.svelte';
	import type { Part } from './inline';
	import { unfurl, type Card } from './unfurl';

	// Every link gets a card now (#866, ADR-0031) — YouTube and Spotify from
	// their own oEmbed, everything else from the server, which is the only
	// thing allowed to read a page that is not ours. `unfurl.ts` owns which
	// is which; this draws the result.

	let { parts }: { parts: Part[] } = $props();

	// The first external link in the message gets the card — messengers
	// preview one link, not five.
	const url = $derived(parts.find((p) => p.external)?.text);
	// Undefined while it is being asked for, null when there is nothing to draw.
	let card = $state<Card | null>();

	$effect(() => {
		if (!url) {
			card = null;
			return;
		}
		let alive = true;
		card = undefined;
		void unfurl(url).then((fresh) => {
			// A dead preview costs nothing — the link still works.
			if (alive) card = fresh;
		});
		return () => {
			alive = false;
		};
	});
</script>

<!-- The card holds one height from the moment the line lands (#2686): the
     skeleton stands in its exact box while it is asked for, so a busy channel
     does not shove the thread up once per link as the cards arrive. Only a
     link with nothing to show gives its space back. `whitespace-normal`: the
     line around it is pre-wrap (#2642), which drew the template's own spaces
     between the card's rows as blank lines. -->
{#if url && card === undefined}
	<Skeleton class="mt-1 h-14" />
{:else if card && url}
	<span class="mt-1 flex items-stretch gap-1 whitespace-normal">
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
