<script lang="ts">
	import {
		ChevronDown,
		ChevronUp,
		ListMusic,
		Pencil,
		Star,
		Trash2,
		X,
	} from '@lucide/svelte';
	import { contextMenu, type MenuEntry } from '$lib/context-menu.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { thumbnailFor } from '$lib/room/jukebox-add';
	import {
		commandFromLink,
		queueSavedPlaylist,
		type SavedPlaylist,
		type SavedTrack,
		type createPlaylistStore,
	} from '$lib/room/playlists.svelte';

	// One saved playlist (#627): the row folds open onto its own tracks, add
	// and delete live here — reorder is out of scope (#627 asked only for
	// creation, adding and deleting).
	let {
		playlist,
		store,
		slug,
		roomScoped,
		onSetActive,
	}: {
		playlist: SavedPlaylist;
		store: ReturnType<typeof createPlaylistStore>;
		/** The room to queue into — always the one this panel is open in. */
		slug: string;
		/** Room playlists only: offers "Set active" in the menu. */
		roomScoped: boolean;
		onSetActive?: () => void;
	} = $props();

	let open = $state(false);
	let tracks = $state<SavedTrack[] | null>(null);
	let renaming = $state(false);
	let name = $state('');
	let url = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	// Follows the server's name unless the rider is actively typing one in —
	// a refresh mid-edit (another tab renamed it) must not clobber a keystroke.
	$effect(() => {
		if (!renaming) name = playlist.name;
	});

	async function load() {
		tracks = null;
		const res = await store.detail(playlist.id);
		tracks = res.ok ? (res.data?.tracks ?? []) : [];
	}

	function toggle() {
		open = !open;
		if (open && tracks === null) void load();
	}

	async function addTrack() {
		const input = url.trim();
		if (!input) return;
		busy = true;
		error = null;
		const parsed = await commandFromLink(input);
		if (!parsed.ok) {
			busy = false;
			error = parsed.message;
			return;
		}
		const res = await store.addTrack(playlist.id, parsed.command);
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		url = '';
		await load();
	}

	async function removeTrack(trackId: string) {
		const message = await store.removeTrack(playlist.id, trackId);
		if (message) {
			error = message;
			return;
		}
		await load();
	}

	async function saveName() {
		const trimmed = name.trim();
		renaming = false;
		if (!trimmed || trimmed === playlist.name) {
			name = playlist.name;
			return;
		}
		const res = await store.rename(playlist.id, trimmed);
		if (!res.ok) {
			error = res.error.message;
			name = playlist.name;
		}
	}

	async function remove() {
		const snapshot = playlist;
		const message = await store.remove(playlist.id);
		if (message) {
			error = message;
			return;
		}
		toasts.push(`Deleted "${snapshot.name}".`);
	}

	async function queue() {
		busy = true;
		const res = await queueSavedPlaylist(slug, playlist.id);
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		toasts.push(
			res.data?.queued
				? `Queued ${res.data.queued} track${res.data.queued === 1 ? '' : 's'}.`
				: 'Nothing new to queue — the room is already full up.',
		);
	}

	function menu(): MenuEntry[] {
		const entries: MenuEntry[] = [
			{
				label: 'Queue into this room',
				icon: ListMusic,
				onSelect: () => void queue(),
			},
			{ label: 'Rename', icon: Pencil, onSelect: () => (renaming = true) },
		];
		if (roomScoped && !playlist.active && onSetActive)
			entries.push({
				label: 'Set as active',
				icon: Star,
				onSelect: onSetActive,
			});
		entries.push('separator', {
			label: 'Delete',
			icon: Trash2,
			onSelect: () => void remove(),
			danger: true,
		});
		return entries;
	}
</script>

<li
	class="border-muted/15 min-w-0 rounded-lg border"
	{@attach contextMenu(menu)}
>
	<div class="flex min-w-0 items-center gap-2 px-2.5 py-2">
		<button
			onclick={toggle}
			aria-expanded={open}
			aria-label={open ? 'hide tracks' : 'show tracks'}
			class="text-muted hover:text-ink grid h-7 w-6 shrink-0 place-items-center"
		>
			{#if open}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
		</button>
		<div class="min-w-0 flex-1">
			{#if renaming}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					bind:value={name}
					onblur={saveName}
					onkeydown={(e) => e.key === 'Enter' && saveName()}
					autofocus
					class="input input-xs w-full"
				/>
			{:else}
				<button
					onclick={() => (renaming = true)}
					class="block max-w-full truncate text-left text-xs font-medium"
					>{playlist.name}</button
				>
			{/if}
			<p class="text-muted text-[10px]">
				{playlist.trackCount}
				{playlist.trackCount === 1 ? 'track' : 'tracks'}
				{#if playlist.active}<span class="text-neon">· active</span>{/if}
			</p>
		</div>
		<button
			onclick={queue}
			disabled={busy || !playlist.trackCount}
			class="btn btn-secondary btn-xs shrink-0 disabled:opacity-40"
			aria-label="queue this playlist into the room">Queue</button
		>
	</div>

	{#if open}
		<div class="border-muted/15 min-w-0 border-t px-2.5 py-2">
			{#if tracks === null}
				<p class="text-muted text-[11px]">Loading…</p>
			{:else if tracks.length === 0}
				<p class="text-muted text-[11px]">
					No tracks yet — paste a link below.
				</p>
			{:else}
				<ul class="flex flex-col gap-1">
					{#each tracks as track (track.id)}
						<li class="group flex min-w-0 items-center gap-1.5">
							<img
								src={thumbnailFor(track.videoId)}
								alt=""
								loading="lazy"
								referrerpolicy="no-referrer"
								class="bg-surface h-6 w-11 shrink-0 rounded object-cover"
							/>
							<span class="min-w-0 flex-1 truncate text-[11px]"
								>{track.playlistTitle ?? track.title}</span
							>
							{#if track.tracks?.length}
								<span
									class="text-muted shrink-0 font-mono text-[9px] tabular-nums"
									>{track.tracks.length}</span
								>
							{/if}
							<button
								onclick={() => void removeTrack(track.id)}
								aria-label="remove this track"
								class="text-muted hover:text-danger grid h-6 w-6 shrink-0 place-items-center opacity-0 group-hover:opacity-100"
								><X size={12} /></button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<form
				class="mt-2 flex min-w-0 gap-1.5"
				onsubmit={(e) => {
					e.preventDefault();
					void addTrack();
				}}
			>
				<input
					bind:value={url}
					placeholder="Add a YouTube link…"
					class="input input-xs min-w-0 flex-1"
					aria-label="add a track to this playlist"
				/>
				<button
					disabled={!url.trim() || busy}
					class="btn btn-secondary btn-xs shrink-0 disabled:opacity-40"
					>Add</button
				>
			</form>
		</div>
	{/if}

	{#if error}<p class="text-danger px-2.5 pb-2 text-[11px]">{error}</p>{/if}
</li>
