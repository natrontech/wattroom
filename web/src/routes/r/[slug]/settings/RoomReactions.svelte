<script lang="ts">
	// The room's reaction vocabulary (#223, #447): up to eight from the
	// curated set, the first four the mid-ride buttons. Split from the
	// settings page (#1265); the page owns the list and saves on `onchange`.
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { CHEER_ICONS } from '$lib/icons';

	let {
		cheers = $bindable(),
		busy = false,
		onchange,
	}: { cheers: string[]; busy?: boolean; onchange: () => void } = $props();

	// The palette caps at 8 (docs/SPEC.md); [] tells the server "base set".
	const MAX_CHEERS = 8;
	const full = $derived(cheers.length >= MAX_CHEERS);
	// The curated set — plus whatever an older room still holds that is not
	// in it, so it can be taken out. Nothing new can be added outside the set.
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

<section class="panel mt-3 p-6">
	<h2 class="font-display font-bold">Reactions</h2>
	<p class="text-muted mt-1.5 text-xs">
		The room's reaction vocabulary — cheers mid-ride, reactions on chat. Up to {MAX_CHEERS};
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
			>{cheers.length} of {MAX_CHEERS}</span
		>
	</div>
	<button
		onclick={() => ((cheers = []), onchange())}
		disabled={busy}
		class="btn-link mt-3 text-xs disabled:opacity-40"
		>Reset to the base set</button
	>
</section>
