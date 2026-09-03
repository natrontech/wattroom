<script lang="ts">
	import { medals, ROOM_NAME } from '../room/mockRoom.svelte';
	import MedalCard from '$lib/components/MedalCard.svelte';
</script>

<main class="mx-auto max-w-4xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">Medals</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		Auto-awarded per group session, minimum 3 riders. The four medals and their
		criteria are fixed in docs/SPEC.md. Built 4:5 to survive a group chat
		uncropped.
	</p>

	<div class="mt-8 grid gap-6 sm:grid-cols-2">
		{#each medals as medal (medal.name)}
			<MedalCard {medal} roomName={ROOM_NAME} />
		{/each}
	</div>
</main>
