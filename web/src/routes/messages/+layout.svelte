<script lang="ts">
	// Messages is a place (#468, ADR-0020) — and ADR-0020 allows ONE list.
	// The app sidebar already names every room and every friend, so a second
	// column beside it repeated the same names on the same screen (#484).
	// Above md the page is the thread alone and the sidebar is the list;
	// below md the sidebar is a drawer, so the list column stands in for it.
	import { page } from '$app/state';
	import ThreadList from '$lib/messages/ThreadList.svelte';

	let { children } = $props();

	const open = $derived(page.url.pathname !== '/messages');
</script>

<div class="grid h-full min-h-0 grid-cols-1">
	<aside class="min-h-0 flex-col md:hidden {open ? 'hidden' : 'flex'}">
		<ThreadList active={page.url.pathname} />
	</aside>
	<section class="min-h-0 flex-col {open ? 'flex' : 'hidden md:flex'}">
		{@render children()}
	</section>
</div>
