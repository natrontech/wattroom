<script lang="ts">
	import type { Part } from './linkify';

	// Keyless oEmbed for the two services the room speaks — same trick the
	// jukebox uses for titles. A generic unfurl would need a server-side OG
	// fetcher (CORS + SSRF), so anything else just stays a link.
	const OEMBED: [RegExp, (url: string) => string][] = [
		[
			/^((www|music|m)\.)?youtube\.com$|^youtu\.be$/,
			(url) =>
				`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
		],
		[
			/^open\.spotify\.com$/,
			(url) => `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
		],
	];

	type Card = { title: string; thumb?: string; host: string };

	// One fetch per URL per session — a busy chat repeats the same link.
	const cache = new Map<string, Card | null>();

	function endpointFor(url: string): string | null {
		try {
			const host = new URL(url).hostname;
			for (const [pattern, build] of OEMBED)
				if (pattern.test(host)) return build(url);
		} catch {
			/* not a URL */
		}
		return null;
	}

	// The first unfurlable link in the message gets the card — messengers
	// preview one link, not five.
	let { parts }: { parts: Part[] } = $props();
	const url = $derived(
		parts.find((p) => p.external && endpointFor(p.text))?.text,
	);
	let card = $state<Card | null>(null);

	$effect(() => {
		if (!url) {
			card = null;
			return;
		}
		const endpoint = endpointFor(url);
		card = cache.get(url) ?? null;
		if (!endpoint || cache.has(url)) return;
		let alive = true;
		void (async () => {
			let fresh: Card | null = null;
			try {
				const res = await fetch(endpoint);
				const data = res.ok ? await res.json() : null;
				if (data?.title)
					fresh = {
						title: data.title,
						thumb: data.thumbnail_url,
						host: new URL(url).hostname.replace(/^www\./, ''),
					};
			} catch {
				/* a dead preview costs nothing — the link still works */
			}
			cache.set(url, fresh);
			if (alive) card = fresh;
		})();
		return () => {
			alive = false;
		};
	});
</script>

{#if card && url}
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		class="border-ink/10 hover:border-neon/40 bg-surface-raised mt-1 flex items-center gap-2 rounded border p-1.5"
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
			<span class="text-muted/70 block truncate font-mono text-[10px]"
				>{card.host}</span
			>
		</span>
	</a>
{/if}
