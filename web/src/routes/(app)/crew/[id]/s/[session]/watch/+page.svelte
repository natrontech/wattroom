<script lang="ts">
	// Spectating is the session's own page on a phone (#412, #2450): the
	// shell already gives a narrow screen the spectator's view — the crew
	// strip's numbers, no trainer, no controls — so /watch is a redirect,
	// kept so a shared or bookmarked link still lands.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';

	$effect(() => {
		const { id, session } = page.params;
		if (id && session)
			void goto(`/crew/${id}/s/${session}`, { replaceState: true });
	});
</script>

<div class="grid min-h-full place-items-center px-6">
	<div class="text-center" aria-busy="true">
		<Logo size={40} />
		<p class="text-muted mt-4 text-sm">Opening the session…</p>
	</div>
</div>
