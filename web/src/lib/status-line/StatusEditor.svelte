<script lang="ts">
	// Your status line (ADR-0060): an emoji, a few words, and when it clears.
	// Set off the bike, so it is a form like any other, not a ride control.
	// The words come first in the DOM so the dialog opens with the cursor in
	// them (ux.md); the emoji button only draws first.
	import { tick } from 'svelte';
	import Smile from '@lucide/svelte/icons/smile';
	import X from '@lucide/svelte/icons/x';
	import { account } from '$lib/account.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Select from '$lib/components/Select.svelte';
	import EmojiPicker from '$lib/emoji/EmojiPicker.svelte';
	import {
		crewEmoji,
		customName,
		loadCrewEmoji,
	} from '$lib/emoji/crew-emoji.svelte';
	import { chosenCrew } from '$lib/nav/chosen-crew.svelte';
	import { MaxStatusChars } from '$lib/protocol';
	import {
		CLEAR_AFTER,
		clearsAt,
		clearsLabel,
		type ClearAfter,
	} from './clear-after';
	import { statusEditor } from './editor.svelte';
	import { PRESETS } from './presets';
	import StatusMark from './StatusMark.svelte';

	const current = account.me?.statusLine ?? null;
	let emoji = $state(current?.emoji ?? '');
	let emojiId = $state(current?.emojiId ?? '');
	let text = $state(current?.text ?? '');
	// A line that already clears keeps its time unless the rider picks another.
	let clear = $state<ClearAfter | 'keep'>(
		current?.expiresAt ? 'keep' : 'never',
	);
	const clearOptions = [
		...(current?.expiresAt
			? [{ value: 'keep', label: `Keep — ${clearsLabel(current.expiresAt)}` }]
			: []),
		...CLEAR_AFTER.map((c) => ({ value: c.key, label: c.label })),
	];

	// Whose emoji the picker offers (ADR-0060): the crew the sidebar is in, or
	// your main crew from You.
	const crewId =
		chosenCrew.id && chosenCrew.id !== 'you'
			? chosenCrew.id
			: (account.me?.homeCrewId ?? undefined);
	if (crewId) void loadCrewEmoji(crewId);

	let picking = $state(false);
	let emojiButton = $state<HTMLButtonElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let saving = $state(false);
	let error = $state<{ message: string; field?: string } | null>(null);

	const draft = $derived({ emoji, emojiId, text: text.trim() });
	const blank = $derived(!draft.emoji && !draft.text);

	function pick(key: string) {
		picking = false;
		error = null;
		// Back to the words once the picker has handed focus back.
		void tick().then(() => input?.focus());
		const name = customName(key);
		if (name) {
			const hit = crewId
				? crewEmoji.list(crewId).find((e) => e.name === name)
				: undefined;
			if (!hit) {
				error = {
					field: 'emoji',
					message: `:${name}: is another crew's — open this from that crew to wear it.`,
				};
				return;
			}
			emoji = key;
			emojiId = hit.id;
			return;
		}
		// Your drawn cheers ride the picker's recents as lucide keys; a
		// status takes an emoji, and the server would refuse one of those.
		if (/^[a-z0-9-]+$/.test(key)) return;
		emoji = key;
		emojiId = '';
	}

	function preset(p: (typeof PRESETS)[number]) {
		emoji = p.emoji;
		emojiId = '';
		text = p.text;
		clear = p.clear;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		error = null;
		const expiresAt =
			clear === 'keep' ? (current?.expiresAt ?? '') : clearsAt(clear);
		const failed = await account.setStatusLine(
			blank
				? null
				: {
						emoji: emojiId ? '' : draft.emoji,
						emojiId,
						text: draft.text,
						expiresAt,
					},
		);
		saving = false;
		if (failed) error = failed;
		else statusEditor.close();
	}

	async function clearIt() {
		saving = true;
		error = null;
		const failed = await account.setStatusLine(null);
		saving = false;
		if (failed) error = failed;
		else statusEditor.close();
	}
</script>

{#snippet fieldError(field: string)}
	{#if error?.field === field}
		<span class="text-danger mt-1 block text-xs">{error.message}</span>
	{/if}
{/snippet}

<!-- Escape answers the picker first: both hear the key, and closing the
     editor with it would throw the draft away. -->
<Modal
	label="Set a status"
	onclose={() => (picking ? (picking = false) : statusEditor.close())}
>
	<h2 class="font-display text-lg leading-tight font-bold">Set a status</h2>
	<p class="text-muted mt-1 text-sm">
		Shown beside your name wherever your crews and friends see it.
	</p>
	<form onsubmit={save} class="mt-4 space-y-4">
		{#if error && !error.field}
			<Banner tone="error">{error.message}</Banner>
		{/if}
		<div>
			<div class="flex items-center gap-2">
				<input
					bind:this={input}
					bind:value={text}
					maxlength={MaxStatusChars}
					placeholder="What's your status?"
					aria-label="Status"
					aria-invalid={error?.field === 'text' ? 'true' : undefined}
					class="input min-w-0 flex-1"
				/>
				<button
					type="button"
					bind:this={emojiButton}
					onclick={() => (picking = !picking)}
					class="btn btn-secondary order-first grid h-10 w-10 shrink-0 place-items-center p-0"
					aria-label={emoji ? `Emoji ${emoji} — pick another` : 'Pick an emoji'}
					title="Pick an emoji"
				>
					{#if emoji}
						<StatusMark line={draft} size={20} />
					{:else}
						<Smile size={18} class="text-muted" />
					{/if}
				</button>
				{#if !blank}
					<button
						type="button"
						onclick={() => {
							emoji = '';
							emojiId = '';
							text = '';
						}}
						class="text-muted hover:text-ink grid h-10 w-10 shrink-0 place-items-center rounded"
						aria-label="Empty the status"
						title="Empty the status"><X size={16} /></button
					>
				{/if}
			</div>
			{@render fieldError('emoji')}
			{@render fieldError('text')}
		</div>

		{#if blank}
			<ul class="space-y-1" aria-label="Suggestions">
				{#each PRESETS as p (p.text)}
					<li>
						<button
							type="button"
							onclick={() => preset(p)}
							class="hover:bg-ink/5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
						>
							<span class="text-base leading-none">{p.emoji}</span>
							<span>{p.text}</span>
							<span class="text-muted ml-auto text-xs"
								>{CLEAR_AFTER.find((c) => c.key === p.clear)?.label}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<div>
				<span class="eyebrow">clear after</span>
				<div class="mt-1">
					<Select
						label="Clear after"
						options={clearOptions}
						value={clear}
						onchange={(next) => (clear = next as ClearAfter | 'keep')}
					/>
				</div>
				{@render fieldError('expiresAt')}
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			<button type="submit" disabled={saving} class="btn btn-primary"
				>{blank && current ? 'Clear status' : 'Save'}</button
			>
			<button
				type="button"
				onclick={statusEditor.close}
				class="btn btn-secondary">Cancel</button
			>
			{#if current && !blank}
				<button
					type="button"
					onclick={clearIt}
					disabled={saving}
					class="btn btn-link ml-auto text-xs">Clear status</button
				>
			{/if}
		</div>
	</form>
	<!-- Inside the modal, which moves itself to <body>: outside it the
	     picker stacked under the modal's backdrop. -->
	{#if picking && emojiButton}
		<EmojiPicker
			anchor={emojiButton}
			{crewId}
			onPick={pick}
			onClose={() => (picking = false)}
		/>
	{/if}
</Modal>
