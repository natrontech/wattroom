<script lang="ts">
	// Friends, as a place (ADR-0020). It was a section at the bottom of /home,
	// under your week's numbers — which is where you look for numbers, not for
	// people.
	import FriendsPanel from '$lib/friends/FriendsPanel.svelte';
</script>

<svelte:head><title>Friends · WattRoom</title></svelte:head>

<main class="mx-auto w-full max-w-2xl px-5 py-6">
	<h1 class="font-display text-2xl font-bold tracking-tight">Friends</h1>
	<p class="text-muted mt-1 text-sm">
		Trade codes to see when each other are around. Presence is room-scoped —
		friends see that you're riding, never what you're pushing.
	</p>
	<FriendsPanel />
</main>
