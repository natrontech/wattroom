<script lang="ts">
	import type { PlaceAddress } from '$lib/channel/address';
	import Plus from '@lucide/svelte/icons/plus';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import JukeboxPlaylistRow from '$lib/channel/JukeboxPlaylistRow.svelte';
	import type { createPlaylistStore } from '$lib/channel/playlists.svelte';

	// The rider's personal playlists, on the library's own page (#1460). Until
	// then they were only reachable inside the jukebox panel under "Mine", so
	// a playlist of your own music needed a jukebox open to build. Same rows
	// as the panel: open to see, reorder and remove entries, add from the
	// search-or-paste field; Queue appears when a voice channel is open.
	let {
		store,
		address,
	}: {
		store: ReturnType<typeof createPlaylistStore>;
		/** The voice channel the rider is standing in, if any — what Queue points at. */
		address?: PlaceAddress | null;
	} = $props();

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

<section class="mt-5">
	<p class="eyebrow flex items-center justify-between">
		<span>playlists</span>
		{#if store.loaded && store.all.length}<span class="num"
				>{store.all.length}</span
			>{/if}
	</p>
	<div class="mt-1.5 min-w-0">
		{#if !store.loaded}
			<Skeleton class="h-9" rows={2} />
		{:else if store.error}
			<p class="text-danger text-xs leading-relaxed">
				{store.error}
				<button onclick={() => store.refresh()} class="ml-1 underline"
					>Retry</button
				>
			</p>
		{:else if store.all.length === 0}
			<p class="text-muted text-xs leading-relaxed">
				No playlists yet. Name one below, then save tracks into it from their
				menu — it follows you into any voice channel you ride in.
			</p>
		{:else}
			<ul class="flex flex-col gap-0.5">
				{#each store.all as playlist (playlist.id)}
					<JukeboxPlaylistRow {playlist} {store} {address} canManage={true} />
				{/each}
			</ul>
		{/if}

		<form
			class="mt-2 flex max-w-md min-w-0 gap-1.5"
			onsubmit={(e) => {
				e.preventDefault();
				void create();
			}}
		>
			<input
				bind:value={newName}
				placeholder="New playlist…"
				class="input input-xs min-w-0 flex-1"
				aria-label="new playlist name"
			/>
			<button
				disabled={!newName.trim() || creating}
				class="btn btn-secondary btn-xs shrink-0 disabled:opacity-40"
				aria-label="create playlist"><Plus size={14} /></button
			>
		</form>
		{#if createError}<p class="text-danger mt-1 text-xs">{createError}</p>{/if}
	</div>
</section>
