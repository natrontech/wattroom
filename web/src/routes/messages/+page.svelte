<script lang="ts">
	// No thread picked: teach where the list is. The sidebar IS the list
	// (#484) — this page never repeats it. Below md the layout shows the
	// thread list instead of this, because the sidebar is a drawer there.
	import { MessagesSquare } from '@lucide/svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<EmptyState variant="page">
	{#snippet icon()}
		<MessagesSquare size={28} class="opacity-60" />
	{/snippet}
	<p class="font-display text-ink mt-3 text-base font-bold">Messages</p>
	<p class="mt-1 text-sm">
		Every room's chat and your notes between friends. Pick a friend in the
		sidebar, or right-click one of your rooms and read its chat — from here a
		room reads and writes without joining it.
	</p>
</EmptyState>
