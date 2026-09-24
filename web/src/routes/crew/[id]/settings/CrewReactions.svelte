<script lang="ts">
	// The crew's reaction set (#223, #447; the room's, moved up by ADR-0058):
	// up to MaxCheers — drawn icons from the curated set, and since #2643 any
	// emoji or one of the crew's own — the first four the mid-ride buttons and
	// all of them first in the chat's picker. The page owns the list and saves
	// on `onchange`.
	import Plus from '@lucide/svelte/icons/plus';
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import EmojiPicker from '$lib/emoji/EmojiPicker.svelte';
	import { CHEER_ICONS } from '$lib/icons';
	import { MaxCheers } from '$lib/protocol';

	let {
		cheers = $bindable(),
		crewId,
		busy = false,
		onchange,
	}: {
		cheers: string[];
		crewId: string;
		busy?: boolean;
		onchange: () => void;
	} = $props();

	let adder = $state<HTMLButtonElement | null>(null);
	let picking = $state(false);

	// [] tells the server "base set".
	const full = $derived(cheers.length >= MaxCheers);
	// The curated icons, then every emoji the set holds — pressed, so a tap
	// takes one out.
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
		The crew's reaction set — cheers mid-ride, and first in line when someone
		reacts in chat. Up to {MaxCheers}; the first four are the mid-ride buttons.
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
		<button
			type="button"
			bind:this={adder}
			onclick={() => (picking = !picking)}
			disabled={busy || full}
			aria-label="add an emoji to the set"
			title={full ? 'the set is full' : 'add an emoji'}
			class="border-muted/25 hover:border-muted/60 text-muted rounded-full border border-dashed p-2 disabled:cursor-not-allowed disabled:opacity-40"
			><Plus size={18} /></button
		>
		{#if picking && adder}
			<EmojiPicker
				anchor={adder}
				{crewId}
				onPick={(key) => {
					picking = false;
					if (!cheers.includes(key)) toggleCheer(key);
				}}
				onClose={() => (picking = false)}
			/>
		{/if}
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
