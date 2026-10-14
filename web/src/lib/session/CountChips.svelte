<script lang="ts">
	let {
		secondsLeft,
		size = 'size-7',
	}: {
		secondsLeft: number;
		/** The chip's box, and on the TV its type, in vh. */
		size?: string;
	} = $props();

	// The last three seconds of a block light their chip (v2-erg's 3-2-1).
	const counting = $derived(Math.ceil(secondsLeft));
</script>

{#each [3, 2, 1] as n (n)}
	<span
		data-testid="count-chip"
		class="num grid {size} shrink-0 place-items-center rounded border {counting ===
		n
			? 'border-neon text-ink'
			: 'border-neon/40 text-muted'}">{n}</span
	>
{/each}
