<script lang="ts">
	// The spectator page is the room now (#412).
	//
	// This route was the pre-ADR-0020 read-only dashboard every narrow viewport
	// was redirected to: a ranked watts list, four cheer buttons and a chat
	// tail, in a frame of its own. #383 rebuilt everything around it and left
	// it behind, so a phone got the old app while every desktop width got the
	// new one. The room reaches a phone directly now — the drawer carries its
	// places, the crew strip carries everyone's watts, the people sheet carries
	// the reactions, and the Chat place carries the talk.
	//
	// The route stays as a redirect rather than being deleted: it was linked
	// from the old view's own footer and is the URL a phone has been landing on
	// since #124, so a bookmark or a pasted link has to keep working. It lands
	// on the Lounge — where a room's share link lands too.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';

	const slug = $derived(page.params.slug ?? '');

	$effect(() => {
		if (slug) void goto(`/r/${slug}`, { replaceState: true });
	});
</script>

<div class="grid min-h-full place-items-center px-6">
	<div class="text-center" aria-busy="true">
		<Logo size={40} />
		<p class="text-muted mt-4 text-sm">Opening the room…</p>
	</div>
</div>
