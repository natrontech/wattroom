<script lang="ts">
	// The crew's reaction vocabulary (#223, #447; the room's, moved up by
	// ADR-0058): up to MaxCheers from the curated set, the first four the
	// mid-ride buttons. The page owns the list and saves on `onchange`.
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { CHEER_ICONS } from '$lib/icons';
	import { MaxCheers } from '$lib/protocol';

	let {
		cheers = $bindable(),
		busy = false,
		onchange,
	}: { cheers: string[]; busy?: boolean; onchange: () => void } = $props();

	// [] tells the server "base set".
	const full = $derived(cheers.length >= MaxCheers);
	// The curated set — plus whatever an older palette still holds that is
	// not in it, so it can be taken out. Nothing new can be added outside the set.
	const palette = $derived([
		...Object.keys(CHEER_ICONS),
		...cheers.filter((c) => !(c in CHEER_ICONS)),
	]);

	function toggleCheer(key: string) {
		if (cheers.includes(key)) cheers = cheers.filter((c) => c !== key);
		else if (!full) cheers = [...cheers, key];
		else return;
		onchange();
	}
</script>

<section class="panel panel-xl mt-5">
	<h2 class="font-display font-bold">Reactions</h2>
	<p class="text-muted mt-1.5 text-xs">
		The crew's reaction vocabulary — cheers mid-ride, reactions on chat. Up to {MaxCheers};
		the first four are the mid-ride buttons.
	</p>
	<div class="mt-3 flex flex-wrap items-center gap-1.5">
		{#each palette as key (key)}
			{@const pressed = cheers.includes(key)}
			<button
				type="button"
				aria-pressed={pressed}
				aria-label={key}
				title={pressed ? `remove ${key}` : full ? 'the set is full' : key}
				onclick={() => toggleCheer(key)}
				disabled={busy || (!pressed && full)}
				class="border-muted/25 rounded-full border p-2 {pressed
					? 'ring-neon bg-neon/15 ring-1'
					: 'hover:border-muted/60'} disabled:cursor-not-allowed disabled:opacity-40"
				><CheerIcon cheer={key} size={18} /></button
			>
		{/each}
		<span class="text-muted ml-1 text-xs tabular-nums"
			>{cheers.length} of {MaxCheers}</span
		>
	</div>
	<button
		onclick={() => ((cheers = []), onchange())}
		disabled={busy}
		class="btn-link mt-3 text-xs disabled:opacity-40"
		>Reset to the base set</button
	>
</section>
