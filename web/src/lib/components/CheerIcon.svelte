<script lang="ts">
	import {
		customName,
		crewEmoji,
		emojiCrew,
	} from '$lib/emoji/crew-emoji.svelte';
	import { iconFor } from '$lib/icons';

	// One reaction, whatever it is (#223, #2643): a drawn icon from the curated
	// set, a Unicode emoji as itself, or a crew's own `:name:` as its picture —
	// the text it is when nobody here knows it, or outside a crew. The
	// accessible name is the caller's: a button holding this labels itself.
	let {
		cheer,
		size = 16,
		class: cls = '',
	}: { cheer: string; size?: number; class?: string } = $props();

	const crew = emojiCrew();
	const custom = $derived(customName(cheer));
	const src = $derived.by(() => {
		const id = crew();
		return custom && id ? crewEmoji.url(id, custom) : null;
	});
	// An icon key's shape — the server's IsIconKey; anything else is an emoji.
	const Icon = $derived(
		/^[a-z][a-z0-9-]{1,31}$/.test(cheer) ? iconFor(cheer) : null,
	);
</script>

{#if custom}
	{#if src}
		<img
			{src}
			alt=""
			width={size}
			height={size}
			class="inline-block shrink-0 object-contain {cls}"
		/>
	{:else}
		<span class="shrink-0 {cls}" aria-hidden="true">{cheer}</span>
	{/if}
{:else if Icon}
	<Icon {size} class="shrink-0 {cls}" aria-hidden="true" />
{:else}
	<span
		class="inline-block shrink-0 text-center leading-none {cls}"
		style:font-size="{size}px"
		style:width="{size * 1.2}px"
		aria-hidden="true">{cheer}</span
	>
{/if}
