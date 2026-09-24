<script lang="ts">
	import CheerIcon from '$lib/components/CheerIcon.svelte';

	// What sits under a message: the reactions it has (#223). The same row in
	// a text channel and in a DM; a press toggles yours. Adding one is the
	// thread's emoji picker (#2643).
	let {
		id,
		counts = {},
		myReacts = {},
		onReact,
	}: {
		id: string;
		/** reaction key → count, for this message. */
		counts?: Record<string, number>;
		/** "id:key" → I pressed it. */
		myReacts?: Record<string, boolean>;
		onReact: (cheer: string) => void;
	} = $props();

	const shown = $derived(Object.entries(counts).filter(([, n]) => n > 0));
</script>

{#if shown.length > 0}
	<span class="mt-0.5 flex flex-wrap gap-1">
		{#each shown as [cheer, count] (cheer)}
			<button
				onclick={() => onReact(cheer)}
				aria-label="{cheer} {count}"
				aria-pressed={!!myReacts[`${id}:${cheer}`]}
				class="inline-flex min-h-6 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] tabular-nums ring-1 {myReacts[
					`${id}:${cheer}`
				]
					? 'ring-neon bg-neon/15'
					: 'ring-ink/10 bg-surface-raised'}"
				><CheerIcon {cheer} size={14} />{count}</button
			>
		{/each}
	</span>
{/if}
