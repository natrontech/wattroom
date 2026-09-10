<script lang="ts">
	// No thread picked: teach where the list is. The sidebar IS the list
	// (#484) — this page never repeats it. Below md the layout shows the
	// thread list instead of this, because the sidebar is a drawer there.
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<svelte:head><title>Messages · WattRoom</title></svelte:head>

<EmptyState variant="page">
	{#snippet icon()}
		<MessagesSquare size={28} class="opacity-60" />
	{/snippet}
	<p class="font-display text-ink mt-3 text-base font-bold">Messages</p>
	<p class="mt-1 text-sm">
		Every room's chat and your notes between friends. Pick a conversation in the
		sidebar, or the unread count on one of your rooms to read its chat — from
		here a room reads and writes without joining it.
	</p>
	<!-- The way to a first thread (#1819): the sidebar lists threads, never
	     friends, so "pick a friend in the sidebar" pointed at an empty heading. -->
	{#snippet cta()}
		<a href="/friends" class="btn btn-primary btn-xs">Message a friend</a>
	{/snippet}
</EmptyState>
