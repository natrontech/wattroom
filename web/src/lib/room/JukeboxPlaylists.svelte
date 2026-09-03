<script lang="ts">
	import { Plus, Shuffle, ListOrdered } from '@lucide/svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import JukeboxPlaylistRow from '$lib/room/JukeboxPlaylistRow.svelte';
	import {
		createPlaylistStore,
		getAutoplay,
		singleVideoFromLink,
		updateAutoplay,
		type AutoplaySettings,
	} from '$lib/room/playlists.svelte';

	// The saved shelf above the live queue (#627): room playlists (any member
	// edits, one markable active) and personal playlists (a rider's own,
	// queueable into whichever room they're in), plus the room's autoplay
	// setting — a jukebox control like every other, so it lives here rather
	// than the owner-only room settings page.
	let { slug }: { slug: string } = $props();

	let tab = $state<'room' | 'mine'>('room');
	const roomStore = $derived.by(() =>
		createPlaylistStore(`/api/rooms/${slug}/playlists`),
	);
	const mineStore = createPlaylistStore('/api/playlists');
	const store = $derived(tab === 'room' ? roomStore : mineStore);

	let newName = $state('');
	let creating = $state(false);
	let createError = $state<string | null>(null);

	async function create() {
		const name = newName.trim();
		if (!name) return;
		creating = true;
		createError = null;
		const res = await store.create(name);
		creating = false;
		if (!res.ok) {
			createError = res.error.message;
			return;
		}
		newName = '';
	}

	// ── Autoplay (#627): a room-level setting, but a jukebox control — every
	// member reads and changes it, matching every other row in the matrix. ──
	let autoplay = $state<AutoplaySettings | null>(null);
	let autoplayError = $state<string | null>(null);
	let fixedUrl = $state('');
	let savingAutoplay = $state(false);

	$effect(() => {
		if (slug) void loadAutoplay();
	});

	async function loadAutoplay() {
		const res = await getAutoplay(slug);
		if (res.ok) {
			autoplay = res.data ?? null;
			autoplayError = null;
		} else {
			autoplay = null;
			autoplayError = res.error.message;
		}
	}

	async function saveAutoplay(next: Partial<AutoplaySettings>) {
		if (!autoplay) return;
		const merged = { ...autoplay, ...next };
		savingAutoplay = true;
		autoplayError = null;
		const res = await updateAutoplay(slug, merged);
		savingAutoplay = false;
		if (!res.ok) {
			autoplayError = res.error.message;
			return;
		}
		autoplay = res.data ?? merged;
	}

	async function setFixed() {
		const input = fixedUrl.trim();
		if (!input) return saveAutoplay({ fixedVideoId: '', fixedVideoTitle: '' });
		const parsed = await singleVideoFromLink(input);
		if (!parsed.ok) {
			autoplayError = parsed.message;
			return;
		}
		fixedUrl = '';
		await saveAutoplay({
			fixedVideoId: parsed.videoId,
			fixedVideoTitle: parsed.title,
		});
	}

	function setActive(id: string) {
		void saveAutoplay({ activePlaylistId: id });
	}
</script>

<details class="min-w-0">
	<summary class="eyebrow cursor-pointer select-none">playlists</summary>

	<div class="mt-2 flex gap-1.5" role="tablist">
		<button
			role="tab"
			aria-selected={tab === 'room'}
			onclick={() => (tab = 'room')}
			class="btn btn-xs {tab === 'room' ? 'btn-secondary' : 'text-muted'}"
			>Room</button
		>
		<button
			role="tab"
			aria-selected={tab === 'mine'}
			onclick={() => (tab = 'mine')}
			class="btn btn-xs {tab === 'mine' ? 'btn-secondary' : 'text-muted'}"
			>Mine</button
		>
	</div>

	{#if tab === 'room' && !autoplay && autoplayError}
		<p class="text-danger mt-2 text-[11px] leading-relaxed">
			{autoplayError}
			<button onclick={() => void loadAutoplay()} class="ml-1 underline"
				>Retry</button
			>
		</p>
	{:else if tab === 'room' && autoplay}
		<div class="border-muted/15 mt-2 min-w-0 rounded-lg border p-2.5">
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs font-medium">Autoplay</span>
				<button
					role="switch"
					aria-checked={autoplay.enabled}
					onclick={() => saveAutoplay({ enabled: !autoplay?.enabled })}
					disabled={savingAutoplay}
					class="btn btn-xs {autoplay.enabled ? 'btn-secondary' : 'text-muted'}"
					>{autoplay.enabled ? 'On' : 'Off'}</button
				>
			</div>
			<p class="text-muted mt-1 text-[10px] leading-relaxed">
				Starts the active room playlist when someone joins an idle deck.
			</p>
			<div
				class="mt-2 flex gap-1.5"
				role="radiogroup"
				aria-label="autoplay order"
			>
				<button
					role="radio"
					aria-checked={autoplay.order === 'ordered'}
					onclick={() => saveAutoplay({ order: 'ordered' })}
					disabled={savingAutoplay}
					class="btn btn-xs flex-1 gap-1 {autoplay.order === 'ordered'
						? 'ring-neon bg-neon/15 ring-1'
						: 'text-muted'}"><ListOrdered size={12} /> Ordered</button
				>
				<button
					role="radio"
					aria-checked={autoplay.order === 'shuffled'}
					onclick={() => saveAutoplay({ order: 'shuffled' })}
					disabled={savingAutoplay}
					class="btn btn-xs flex-1 gap-1 {autoplay.order === 'shuffled'
						? 'ring-neon bg-neon/15 ring-1'
						: 'text-muted'}"><Shuffle size={12} /> Shuffled</button
				>
			</div>
			{#if !autoplay.activePlaylistId}
				<p class="text-muted mt-1.5 text-[10px]">
					No active playlist yet — set one from a room playlist's menu.
				</p>
			{/if}
			<label class="mt-2 block">
				<span class="text-muted text-[10px]">Fixed start (optional)</span>
				<div class="mt-1 flex min-w-0 gap-1.5">
					<input
						bind:value={fixedUrl}
						placeholder={autoplay.fixedVideoTitle || 'Always play this first…'}
						class="input input-xs min-w-0 flex-1"
					/>
					<button
						onclick={setFixed}
						disabled={savingAutoplay}
						class="btn btn-secondary btn-xs shrink-0">Set</button
					>
					{#if autoplay.fixedVideoId}
						<button
							onclick={() =>
								saveAutoplay({ fixedVideoId: '', fixedVideoTitle: '' })}
							disabled={savingAutoplay}
							class="btn btn-xs text-muted shrink-0">Clear</button
						>
					{/if}
				</div>
			</label>
			{#if autoplayError}<p class="text-danger mt-1.5 text-[11px]">
					{autoplayError}
				</p>{/if}
		</div>
	{/if}

	<div class="mt-2 min-w-0">
		{#if !store.loaded}
			<Skeleton class="h-9" rows={2} />
		{:else if store.error}
			<p class="text-danger text-[11px] leading-relaxed">
				{store.error}
				<button onclick={() => store.refresh()} class="ml-1 underline"
					>Retry</button
				>
			</p>
		{:else if store.all.length === 0}
			<p class="text-muted text-[11px] leading-relaxed">
				{tab === 'room'
					? 'No room playlists yet — the first one below is a click away.'
					: "No personal playlists yet — yours to build, queueable in any room you're in."}
			</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each store.all as playlist (playlist.id)}
					<JukeboxPlaylistRow
						{playlist}
						{store}
						{slug}
						roomScoped={tab === 'room'}
						onSetActive={tab === 'room'
							? () => setActive(playlist.id)
							: undefined}
					/>
				{/each}
			</ul>
		{/if}

		<form
			class="mt-2 flex min-w-0 gap-1.5"
			onsubmit={(e) => {
				e.preventDefault();
				void create();
			}}
		>
			<input
				bind:value={newName}
				placeholder={tab === 'room'
					? 'New room playlist…'
					: 'New personal playlist…'}
				class="input input-xs min-w-0 flex-1"
				aria-label="new playlist name"
			/>
			<button
				disabled={!newName.trim() || creating}
				class="btn btn-secondary btn-xs shrink-0 disabled:opacity-40"
				aria-label="create playlist"><Plus size={14} /></button
			>
		</form>
		{#if createError}<p class="text-danger mt-1 text-[11px]">
				{createError}
			</p>{/if}
	</div>
</details>
