<script lang="ts">
	// The crew's own emoji (#2643): any member adds one, the one who added it
	// or the crew's owner and admins take it down. A reaction as `:name:`, and
	// the same `:name:` inside a message.
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { compressImage } from '$lib/chat/media';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { confirm } from '$lib/confirm.svelte';
	import {
		crewEmoji,
		loadCrewEmoji,
		EMOJI_NAME,
		type CrewEmoji,
	} from '$lib/emoji/crew-emoji.svelte';
	import {
		MaxCrewEmoji,
		MaxEmojiBytes,
		MaxEmojiNameChars,
		MinEmojiNameChars,
	} from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';

	let { crewId, administers }: { crewId: string; administers: boolean } =
		$props();

	const list = $derived(crewEmoji.list(crewId));
	const full = $derived(list.length >= MaxCrewEmoji);

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	async function load() {
		loading = true;
		loadError = await loadCrewEmoji(crewId);
		loading = false;
	}
	void load();

	let name = $state('');
	let file = $state<File | null>(null);
	let nameError = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let busy = $state(false);
	let picker = $state<HTMLInputElement | null>(null);

	/** "Party Parrot!.gif" → "party_parrot": a name the rule accepts, from the file. */
	const nameFrom = (filename: string) =>
		filename
			.replace(/\.[^.]*$/, '')
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, MaxEmojiNameChars);

	function picked(chosen: File | undefined) {
		if (!chosen) return;
		file = chosen;
		fileError = null;
		if (!name) name = nameFrom(chosen.name);
	}

	async function add() {
		nameError = new RegExp(`^${EMOJI_NAME}$`).test(name)
			? null
			: `A name is ${MinEmojiNameChars}–${MaxEmojiNameChars} characters: a–z, 0–9 and _.`;
		if (!file) fileError = 'Pick a picture first.';
		if (nameError || !file) return;
		busy = true;
		// A still shrinks to the size it is drawn at; a GIF keeps its frames,
		// so it has to arrive small enough itself.
		const blob = await compressImage(file, 128);
		if (!blob || blob.size > MaxEmojiBytes) {
			busy = false;
			fileError = `An emoji is at most ${MaxEmojiBytes / 1024} KB. A still picture shrinks itself; a GIF has to be made smaller first.`;
			return;
		}
		const res = await api<CrewEmoji>(
			`/api/crews/${crewId}/emoji?name=${encodeURIComponent(name)}`,
			{ method: 'POST', body: blob, headers: { 'content-type': blob.type } },
		);
		busy = false;
		if (!res.ok) {
			if (res.error.field === 'name') nameError = res.error.message;
			else fileError = res.error.message;
			return;
		}
		toasts.push(`:${name}: is the crew's now.`);
		name = '';
		file = null;
		await loadCrewEmoji(crewId);
	}

	async function remove(emoji: CrewEmoji) {
		// Irreversible, and paid by others: every line and reaction that uses
		// it falls back to text (errors.md, #1493).
		const yes = await confirm({
			title: `Delete :${emoji.name}:?`,
			body: `Every reaction and message that uses it shows :${emoji.name}: as text instead. Anyone in the crew can add one by that name again.`,
			action: 'Delete it',
		});
		if (!yes) return;
		const res = await api(`/api/crews/${crewId}/emoji/${emoji.id}`, {
			method: 'DELETE',
		});
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await loadCrewEmoji(crewId);
	}
</script>

<section id="emoji" class="panel panel-xl mt-5 scroll-mt-4">
	<h2 class="font-display font-bold">Emoji</h2>
	<p class="text-muted mt-1.5 text-xs">
		The crew's own — a reaction, or in a message as <code>:name:</code>. Any
		member adds one. {list.length} of {MaxCrewEmoji}.
	</p>

	{#if loading && list.length === 0}
		<Skeleton rows={2} class="mt-3 h-10" />
	{:else if loadError && list.length === 0}
		<div class="mt-3">
			<Banner tone="error">
				{loadError}
				{#snippet action()}
					<button onclick={() => void load()} class="btn btn-secondary btn-xs"
						><RotateCw size={12} /> Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if list.length === 0}
		<p class="text-muted mt-3 text-sm">
			None yet. Add the first — a face, an in-joke, the climb everyone hates.
		</p>
	{:else}
		<ul
			class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-1.5"
		>
			{#each list as emoji (emoji.id)}
				<li
					class="bg-surface-raised flex min-w-0 items-center gap-2 rounded px-2 py-1.5"
				>
					<img
						src="/api/crews/{crewId}/emoji/{emoji.id}"
						alt=""
						width="24"
						height="24"
						class="shrink-0 object-contain"
					/>
					<span class="min-w-0 flex-1 truncate font-mono text-xs"
						>:{emoji.name}:</span
					>
					{#if administers || emoji.userId === account.me?.id}
						<button
							onclick={() => void remove(emoji)}
							class="icon-btn text-muted-dim hover:text-danger h-6 w-6"
							aria-label="delete :{emoji.name}:"
							title="delete :{emoji.name}:"><Trash2 size={13} /></button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if full}
		<p class="text-muted mt-3 text-xs">
			The crew has {MaxCrewEmoji} — take one down to add another.
		</p>
	{:else}
		<form
			class="mt-4 flex flex-wrap items-start gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				void add();
			}}
		>
			<input
				bind:this={picker}
				type="file"
				accept="image/png,image/gif,image/webp,image/jpeg"
				class="hidden"
				onchange={(e) => {
					picked(e.currentTarget.files?.[0]);
					e.currentTarget.value = '';
				}}
			/>
			<button
				type="button"
				onclick={() => picker?.click()}
				class="btn btn-secondary max-w-full"
				><span class="truncate">{file ? file.name : 'Pick a picture'}</span
				></button
			>
			<label class="flex min-w-0 flex-1 basis-40 items-center gap-1">
				<span class="text-muted font-mono text-sm">:</span>
				<input
					bind:value={name}
					maxlength={MaxEmojiNameChars}
					placeholder="name"
					aria-label="emoji name"
					aria-invalid={!!nameError}
					class="input min-w-0 flex-1 font-mono"
				/>
				<span class="text-muted font-mono text-sm">:</span>
			</label>
			<button disabled={busy} class="btn btn-primary">Add</button>
		</form>
		{#if nameError}
			<p class="text-danger mt-1 text-xs">{nameError}</p>
		{/if}
		{#if fileError}
			<p class="text-danger mt-1 text-xs">{fileError}</p>
		{/if}
		<p class="text-muted-dim mt-1.5 text-[11px]">
			PNG, WebP or JPEG, drawn at 128 px — square works best. A GIF keeps its
			animation up to {MaxEmojiBytes / 1024} KB.
		</p>
	{/if}
</section>
