<script lang="ts">
	/**
	 * The riding surface (ADR-0046, #3081): one layout for a session's
	 * Training place and a solo ride, slot by slot — the header (1), what has
	 * the focus (2), your numbers (3), the crew (4) and the horizon (5), with a
	 * ride's status line between the header and the focus. Each slot keeps its
	 * own row whether or not it draws anything, so the focus always takes the
	 * free height; what fills a slot, and its padding, is the caller's.
	 */
	import type { Snippet } from 'svelte';

	let {
		header,
		status,
		focus,
		numbers,
		crew,
		horizon,
		class: extra = '',
	}: {
		header: Snippet;
		status?: Snippet;
		focus: Snippet;
		numbers?: Snippet;
		crew?: Snippet;
		horizon?: Snippet;
		class?: string;
	} = $props();
</script>

<div
	class="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto_auto_auto] {extra}"
>
	<div class="row-start-1 min-w-0">{@render header()}</div>
	{#if status}<div class="row-start-2 min-w-0">{@render status()}</div>{/if}
	<!-- The focus fills its row: one stretched cell, allowed to shrink below its content. -->
	<div class="row-start-3 grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
		{@render focus()}
	</div>
	{#if numbers}<div class="row-start-4 min-w-0">{@render numbers()}</div>{/if}
	{#if crew}<div class="row-start-5 min-w-0">{@render crew()}</div>{/if}
	{#if horizon}<div class="row-start-6 min-w-0">{@render horizon()}</div>{/if}
</div>
