<script lang="ts">
	// The channel's ride place while nothing runs (#2449): pair a trainer,
	// open a session. The moment one opens it has its own address (#2450),
	// and the page moves there — the same shell and connection, the ride's
	// own URL, the one to share.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { roomConnection } from '$lib/room/connection.svelte';
	import Training from '$lib/room/Training.svelte';

	const session = $derived(roomConnection.current?.live.tick?.state.id);
	$effect(() => {
		if (session && page.params.id)
			void goto(`/crew/${page.params.id}/s/${session}`, {
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
	});
</script>

<Training />
