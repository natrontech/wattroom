<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { account } from '$lib/account.svelte';
	import { goto } from '$app/navigation';

	// Where a signed-in "/" goes (ADR-0061): "/" is the prerendered landing
	// now, so the server sends a request carrying a session here, and the
	// shell's routing effect picks the rider's place — the stashed deep link,
	// the crew they were invited to, the crew the sidebar opens in, else Home.
	// A session the server no longer knows lands back on the landing, by a
	// client navigation: a reload of "/" would bounce here again.
	$effect(() => {
		if (account.loaded && !account.me) void goto('/', { replaceState: true });
	});
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="grid min-h-dvh place-items-center" aria-busy="true">
	<div class="text-center">
		<Logo size={40} />
		<p class="text-muted mt-4 text-sm">Opening WattRoom…</p>
	</div>
</div>
