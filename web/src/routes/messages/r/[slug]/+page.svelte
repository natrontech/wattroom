<script lang="ts">
	import { page } from '$app/state';
	import RoomThread from '$lib/messages/RoomThread.svelte';

	const slug = $derived(page.params.slug ?? '');
</script>

<!-- Keyed: switching rooms is a new thread, not the old one's draft and
     scroll position with different lines in it. -->
{#key slug}
	<RoomThread {slug} />
{/key}
