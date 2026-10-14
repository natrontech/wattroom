<script lang="ts">
	import type { Snippet } from 'svelte';

	// Riding, what the people column holds beyond the seat opens over the
	// crew instead of pushing it down (#3983): v2-ride keeps the crew panel
	// straight under the seat, and a fold that grew the column moved the
	// crew off the frame.
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<details class="relative min-w-0">
	<summary class="ride-label cursor-pointer py-2 select-none">{label}</summary>
	<div
		class="bg-surface border-neon/40 absolute inset-x-0 top-full z-20 flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-lg border p-2"
	>
		{@render children()}
	</div>
</details>
