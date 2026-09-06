<script lang="ts">
	import type { Part } from './inline';
	import { isYouTube, unfurl, type Card } from './unfurl';
	import ListPlus from '@lucide/svelte/icons/list-plus';

	// Every link gets a card now (#866, ADR-0031) — YouTube and Spotify from
	// their own oEmbed, everything else from the server, which is the only
	// thing allowed to read a page that is not ours. `unfurl.ts` owns which
	// is which; this draws the result.

	let {
		parts,
		onQueue,
	}: {
		parts: Part[];
		/** Given in a room: a YouTube card grows a Queue button, so a link
		 *  dropped in the chat is one tap from the jukebox. */
		onQueue?: (url: string) => void;
	} = $props();

	// The first external link in the message gets the card — messengers
	// preview one link, not five.
	const url = $derived(parts.find((p) => p.external)?.text);
	let card = $state<Card | null>(null);
	const queueable = $derived(!!onQueue && !!card && isYouTube(card.host));

	$effect(() => {
		if (!url) {
			card = null;
			return;
		}
		let alive = true;
		card = null;
		void unfurl(url).then((fresh) => {
			// A dead preview costs nothing — the link still works.
			if (alive) card = fresh;
		});
		return () => {
			alive = false;
		};
	});
</script>

{#if card && url}
	<span class="mt-1 flex items-stretch gap-1">
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			class="border-ink/10 hover:border-neon/40 bg-surface-raised flex min-w-0 flex-1 items-center gap-2 rounded border p-1.5"
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
					<span class="text-muted/80 block truncate text-[10px] leading-tight"
						>{card.description}</span
					>
				{/if}
				<span class="text-muted/70 block truncate font-mono text-[10px]"
					>{card.siteName || card.host}</span
				>
			</span>
		</a>
		{#if queueable}
			<!-- The whole reason a link lands in the chat during a ride. -->
			<button
				onclick={() => onQueue?.(url)}
				class="border-ink/10 hover:border-neon/40 bg-surface-raised text-muted hover:text-ink flex shrink-0 flex-col items-center justify-center gap-0.5 rounded border px-2 text-[10px]"
				title="add to the jukebox queue"
				aria-label="add {card.title} to the jukebox queue"
			>
				<ListPlus size={14} />
				queue
			</button>
		{/if}
	</span>
{/if}
