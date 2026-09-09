<script lang="ts">
	import { page } from '$app/state';
	import RoomThread from '$lib/messages/RoomThread.svelte';
	import { presence } from '$lib/presence.svelte';

	const slug = $derived(page.params.slug ?? '');
</script>

<svelte:head
	><title
		>{presence.rooms.find((r) => r.slug === slug)?.name ?? slug} · Chat · WattRoom</title
	></svelte:head
>

<!-- Keyed: switching rooms is a new thread, not the old one's draft and
     scroll position with different lines in it. -->
{#key slug}
	<RoomThread {slug} />
{/key}
