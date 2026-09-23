<script lang="ts">
	import type { PlaceAddress } from '$lib/room/address';
	import Plus from '@lucide/svelte/icons/plus';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import JukeboxPlaylistRow from '$lib/room/JukeboxPlaylistRow.svelte';
	import { useRoom } from '$lib/room/context';
	import type { createPlaylistStore } from '$lib/room/playlists.svelte';

	// The saved playlists above the live queue (#627): room playlists (any
	// member edits, one markable active) and personal playlists (a rider's
	// own, queueable into whichever room they're in). Autoplay is a voice
	// channel's setting and lives on the crew's Settings page (#1422, #2454).
	let {
		address,
		roomStore,
		mineStore,
	}: {
		/** Where the panel is open (#2449): a voice channel, whose shelf is
		 *  its crew's. */
		address: PlaceAddress;
		/** Made by the column (#1427), which also saves rows into them. */
		roomStore: ReturnType<typeof createPlaylistStore>;
		mineStore: ReturnType<typeof createPlaylistStore>;
	} = $props();

	// Rename, delete, set active and remove a track are the coach's and the
	// owner's (SPEC roles matrix, #771); a member's own personal playlists
	// stay theirs. Gated here so nothing renders that the server would refuse
	// on click (#824).
	const room = useRoom();
	const canManage = $derived(room.canManage);

	let tab = $state<'room' | 'mine'>('room');
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
</script>

<details class="min-w-0">
	<summary class="eyebrow cursor-pointer select-none">playlists</summary>

	<div class="mt-2 flex gap-1.5" role="tablist">
		<button
			role="tab"
			aria-selected={tab === 'room'}
			onclick={() => (tab = 'room')}
			class="btn btn-xs {tab === 'room' ? 'btn-secondary' : 'text-muted'}"
			>Crew</button
		>
		<button
			role="tab"
			aria-selected={tab === 'mine'}
			onclick={() => (tab = 'mine')}
			class="btn btn-xs {tab === 'mine' ? 'btn-secondary' : 'text-muted'}"
			>Mine</button
		>
	</div>

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
					? 'No crew playlists yet — the first one below is a click away.'
					: "No personal playlists yet — yours to build, queueable in any room you're in."}
			</p>
		{:else}
			<ul class="flex flex-col gap-0.5">
				{#each store.all as playlist (playlist.id)}
					<JukeboxPlaylistRow
						{playlist}
						{store}
						{address}
						roomScoped={tab === 'room'}
						canManage={tab !== 'room' || canManage}
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
