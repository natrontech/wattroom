<script lang="ts">
	import { ROOM_NAME } from '../room/mockRoom.svelte';
	import MedalCard, { type Medal } from '$lib/components/MedalCard.svelte';

	// Criteria are docs/SPEC.md's, verbatim — medals are a fixed set, not a design choice.
	const medals: Medal[] = [
		{
			name: 'Metronome',
			criterion: 'best execution score',
			rider: 'Sara',
			value: '94',
			unit: '%',
			kj: 812,
			xp: 959,
		},
		{
			name: 'Diesel',
			criterion: 'steadiest power',
			rider: 'Nina',
			value: '3.1',
			unit: '% CV',
			kj: 704,
			xp: 838,
		},
		{
			name: 'Hammer',
			criterion: 'biggest 5 s w/kg',
			rider: 'Ruben',
			value: '14.2',
			unit: 'w/kg',
			kj: 968,
			xp: 1103,
		},
		{
			name: 'Lanterne Rouge',
			criterion: 'last on the sprint, finished anyway',
			rider: 'Milo',
			value: '61',
			unit: 'min',
			kj: 502,
			xp: 611,
		},
	];
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
