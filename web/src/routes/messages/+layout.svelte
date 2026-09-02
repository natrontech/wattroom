<script lang="ts">
	// Messages is a place (#468, ADR-0020): the list on the left, the thread
	// on the right — a room's chat and a DM in the same two columns. Below
	// md the two take turns: the list, or the thread with a way back.
	import { page } from '$app/state';
	import ThreadList from '$lib/messages/ThreadList.svelte';

	let { children } = $props();

	const open = $derived(page.url.pathname !== '/messages');
</script>

<div class="grid h-full min-h-0 grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]">
	<aside
		class="border-ink/5 min-h-0 flex-col border-r {open
			? 'hidden md:flex'
			: 'flex'}"
	>
		<ThreadList active={page.url.pathname} />
	</aside>
	<section class="min-h-0 flex-col {open ? 'flex' : 'hidden md:flex'}">
		{@render children()}
	</section>
</div>
