<script lang="ts">
	import type { Snippet } from 'svelte';

	// Riding, what the people column holds beyond the seat opens over the
	// crew instead of pushing it down (#3983): v2-ride keeps the crew panel
	// straight under the seat, and a fold that grew the column moved the
	// crew off the frame.
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<!-- Not positioned, on purpose: the sheet's box is then the people panel's
     own, outside the deck's capped scroll box (SidePanel), which clipped it
     to a sliver. With no top it opens where it stands, under the summary. -->
<details class="min-w-0">
	<summary class="ride-label cursor-pointer py-2 select-none">{label}</summary>
	<div
		class="bg-surface border-neon/40 absolute inset-x-3 z-20 flex max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-lg border p-2"
	>
		{@render children()}
	</div>
</details>
