<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import type { Snippet } from 'svelte';

	// Riding, what the people column holds beyond the seat opens over the
	// crew instead of pushing it down (#3983): v2-ride keeps the crew panel
	// straight under the seat, and a fold that grew the column moved the
	// crew off the frame. `label` is what opens it: the seat's strip, or the
	// jukebox's name while nothing plays.
	let { label, children }: { label: Snippet; children: Snippet } = $props();

	// Fixed, at the rect the fold has when it opens: the deck's capped scroll
	// box and the people panel both clip, and an absolute sheet inside them
	// was cut to a sliver.
	// ponytail: placed on open only; a resize while open leaves it where it was.
	let at = $state({ top: 0, left: 0, width: 0 });
	// Mounted only while open: a shut fold keeps its contents laid out, and a
	// fixed box there measured as a 26 px add field nobody can see.
	let open = $state(false);
	function place(e: Event) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		at = { top: r.bottom, left: r.left, width: r.width };
	}
</script>

<details class="min-w-0" bind:open ontoggle={place}>
	<summary
		data-testid="rail-sheet"
		class="flex min-w-0 cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden"
	>
		<span class="min-w-0 flex-1">{@render label()}</span>
		{#if open}<ChevronUp
				size={16}
				class="text-muted shrink-0"
			/>{:else}<ChevronDown size={16} class="text-muted shrink-0" />{/if}
	</summary>
	{#if open}
		<div
			class="bg-surface border-neon/40 fixed z-30 flex flex-col gap-3 overflow-y-auto rounded-lg border p-2"
			style="top: {at.top}px; left: {at.left}px; width: {at.width}px; max-height: calc(100dvh - {at.top}px - 16px)"
		>
			{@render children()}
		</div>
	{/if}
</details>
