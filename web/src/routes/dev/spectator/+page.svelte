<script lang="ts">
	import SpectatorView from './SpectatorView.svelte';
	import { createRoom, type Phase } from '../room/mockRoom.svelte';

	const room = createRoom();
	$effect(() => {
		void room.start();
		return room.stop;
	});

	const phases: { id: Phase; label: string }[] = [
		{ id: 'lounge', label: 'Lounge' },
		{ id: 'live', label: 'Live' },
	];
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">
		Phone spectator
	</h1>
	<p class="text-muted mt-2 max-w-xl text-sm">
		Read-only room dashboard for a phone — the only thing a spectator can do is
		cheer (roles matrix, docs/SPEC.md). Shown at 375×812; open <code
			class="text-ink/70">/dev/spectator</code
		>
		on a phone to check it in iOS Safari for real.
	</p>

	<div class="mt-6 flex gap-1">
		{#each phases as option (option.id)}
			<button
				onclick={() => room.setPhase(option.id)}
				class="rounded px-3 py-1.5 text-xs {room.phase === option.id
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">{option.label}</button
			>
		{/each}
	</div>

	<div
		class="border-muted/20 mt-4 h-[812px] w-[375px] overflow-hidden rounded-[2rem] border-4 shadow-2xl"
	>
		<SpectatorView
			riders={room.riders}
			segments={room.segments}
			total={room.total}
			elapsed={room.elapsed}
			phase={room.phase}
		/>
	</div>
</main>
