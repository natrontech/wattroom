<script lang="ts">
	// The day-one card (#1151): the migration gave every room owner one crew
	// named after them, and this is the only onboarding the concept gets. Two
	// things it must not do — present the name as decided (so the rename is
	// this field, not a settings page), and announce a privacy change (there
	// was none: every migrated room is exactly as private as it was).
	import { renameCrew } from '$lib/crew';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Pencil from '@lucide/svelte/icons/pencil';
	import X from '@lucide/svelte/icons/x';

	let {
		id,
		name,
		rooms,
		onDismiss,
	}: {
		id: string;
		name: string;
		rooms: number;
		/** Absent on the crew's own page, where the card is always reachable. */
		onDismiss?: () => void;
	} = $props();

	let editing = $state(false);
	let draft = $state('');
	let busy = $state(false);
	let field = $state<HTMLInputElement | null>(null);

	function edit() {
		draft = name;
		editing = true;
		// Focus follows the deliberate tap (ux.md), once the field exists.
		queueMicrotask(() => field?.select());
	}

	async function save() {
		const next = draft.trim();
		editing = false;
		if (!next || next === name) return;
		busy = true;
		const res = await renameCrew(id, next);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		// Every room row carries the crew's name; the list is where it lives.
		presence.reload();
		toasts.push(`Your crew is “${next}” now.`);
	}
</script>

<div class="panel p-3">
	<div class="flex items-center">
		<span class="eyebrow">your crew</span>
		{#if onDismiss}
			<button
				onclick={onDismiss}
				class="icon-btn text-muted hover:text-ink -my-3 -mr-2 ml-auto h-8 w-8"
				title="Got it"
				aria-label="Got it"><X size={14} /></button
			>
		{/if}
	</div>
	{#if editing}
		<input
			bind:this={field}
			bind:value={draft}
			maxlength="60"
			class="input input-xs font-display mt-1 w-full font-bold"
			aria-label="crew name"
			onkeydown={(e) => {
				if (e.key === 'Enter') save();
				if (e.key === 'Escape') editing = false;
			}}
			onblur={save}
		/>
	{:else}
		<button
			onclick={edit}
			disabled={busy}
			class="hover:text-ink mt-1 flex min-h-8 w-full items-center gap-1.5 text-left"
			title="rename your crew"
		>
			<span class="font-display truncate text-sm font-bold">{name}</span>
			<Pencil size={12} class="text-muted shrink-0" aria-hidden="true" />
		</button>
	{/if}
	<p class="text-muted text-[11px]">
		{rooms === 1 ? '1 room' : `${rooms} rooms`} · you own it · rename it
	</p>
	<p class="text-muted/80 mt-1.5 text-[11px]">
		Your rooms live here now, named after you until you say otherwise.
	</p>
</div>
