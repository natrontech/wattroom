<script lang="ts">
	import CheerIcon from '$lib/components/CheerIcon.svelte';

	// What sits under a message: the reactions it has, and — while the
	// rider is picking — the room's palette to add one from (#223). The
	// same row in the room's side panel and in a thread read from outside
	// (#468); the parent owns "who is picking" and what a press does.
	let {
		id,
		counts = {},
		myReacts = {},
		cheers,
		picking = false,
		onReact,
	}: {
		id: string;
		/** cheer → count, for this message. */
		counts?: Record<string, number>;
		/** "id:cheer" → I pressed it. */
		myReacts?: Record<string, boolean>;
		/** The room's reaction vocabulary, icon keys (#447). */
		cheers: string[];
		/** The palette is open under this message. */
		picking?: boolean;
		onReact: (cheer: string) => void;
	} = $props();

	const shown = $derived(Object.entries(counts).filter(([, n]) => n > 0));
</script>

{#if picking}
	<span
		class="bg-surface-raised ring-ink/10 mt-1 inline-flex gap-0.5 rounded-full px-1.5 py-0.5 ring-1"
	>
		{#each cheers as cheer (cheer)}
			<button
				onclick={() => onReact(cheer)}
				aria-label={cheer}
				title={cheer}
				class="px-0.5 py-0.5 hover:scale-125"
				><CheerIcon {cheer} size={16} /></button
			>
		{/each}
	</span>
{/if}
{#if shown.length > 0}
	<span class="mt-0.5 flex flex-wrap gap-1">
		{#each shown as [cheer, count] (cheer)}
			<button
				onclick={() => onReact(cheer)}
				aria-label="{cheer} {count}"
				class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ring-1 {myReacts[
					`${id}:${cheer}`
				]
					? 'ring-neon bg-neon/15'
					: 'ring-ink/10 bg-surface-raised'}"
				><CheerIcon {cheer} size={12} />{count}</button
			>
		{/each}
	</span>
{/if}
