<script lang="ts">
	// The channel's ride place while nothing runs (#2449): pair a trainer,
	// open a session. The moment one opens it has its own address (#2450),
	// and the page moves there — the same shell and connection, the ride's
	// own URL, the one to share.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { sessionPath } from '$lib/channel/address';
	import { roomConnection } from '$lib/channel/connection.svelte';
	import { liveSessionId } from '$lib/channel/tick-session';
	import Training from '$lib/session/Training.svelte';

	const session = $derived(
		liveSessionId(roomConnection.current?.live.tick?.state),
	);
	$effect(() => {
		if (session && page.params.id)
			void goto(sessionPath(page.params.id, session), {
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
	});
</script>

<Training />
