<script lang="ts">
	// Your reaction set (#2722; the crew's until then, ADR-0013): up to
	// MaxCheers drawn icons or emoji — the first four your mid-ride buttons,
	// all of them first in the chat's picker, in every crew and DM. A crew's
	// own emoji stay in the full picker: they mean something in one crew only.
	import Plus from '@lucide/svelte/icons/plus';
	import { account } from '$lib/account.svelte';
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import EmojiPicker from '$lib/emoji/EmojiPicker.svelte';
	import { CHEER_ICONS } from '$lib/icons';
	import { MaxCheers } from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';

	let adder = $state<HTMLButtonElement | null>(null);
	let picking = $state(false);
	let busy = $state(false);

	const cheers = $derived(account.cheers);
	const full = $derived(cheers.length >= MaxCheers);
	// The curated icons, then every emoji the set holds — pressed, so a tap
	// takes one out.
	const palette = $derived([
		...Object.keys(CHEER_ICONS),
		...cheers.filter((c) => !(c in CHEER_ICONS)),
	]);

	async function save(next: string[]) {
		busy = true;
		const refusal = await account.setCheers(next);
		busy = false;
		if (refusal) toasts.push(refusal.message, { tone: 'error' });
	}

	function toggleCheer(key: string) {
		if (cheers.includes(key)) void save(cheers.filter((c) => c !== key));
		else if (!full) void save([...cheers, key]);
	}
</script>

<section class="panel panel-xl mt-3">
	<h2 class="font-display font-bold">Reactions</h2>
	<p class="text-muted mt-1.5 text-xs">
		What you react with, in every crew — your cheers mid-ride, and first in line
		when you react in chat. Up to {MaxCheers}; the first four are your mid-ride
		buttons.
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
			aria-label="add an emoji to your reactions"
			title={full ? 'the set is full' : 'add an emoji'}
			class="border-muted/25 hover:border-muted/60 text-muted rounded-full border border-dashed p-2 disabled:cursor-not-allowed disabled:opacity-40"
			><Plus size={18} /></button
		>
		{#if picking && adder}
			<EmojiPicker
				anchor={adder}
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
		onclick={() => void save([])}
		disabled={busy}
		class="btn-link mt-3 text-xs disabled:opacity-40"
		>Reset to the base set</button
	>
</section>
