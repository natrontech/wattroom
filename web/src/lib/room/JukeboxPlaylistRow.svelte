<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ListMusic from '@lucide/svelte/icons/list-music';
	import Music from '@lucide/svelte/icons/music';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import { contextMenu, type MenuEntry } from '$lib/context-menu.svelte';
	import { toasts } from '$lib/toast.svelte';
	import type { JukeboxCommand } from '$lib/protocol';
	import { thumbnailFor } from '$lib/room/jukebox-add';
	import JukeboxAdd from '$lib/room/JukeboxAdd.svelte';
	import {
		queueSavedPlaylist,
		type SavedPlaylist,
		type SavedTrack,
		type createPlaylistStore,
	} from '$lib/room/playlists.svelte';

	// One saved playlist (#627): the row folds open onto its own tracks, add
	// and delete live here. Adding is the room's own add box (#1426) — search
	// your library or paste a link — pointed at the playlist instead of the
	// deck. Reorder is #1428.
	let {
		playlist,
		store,
		slug,
		roomScoped,
		canManage,
		onSetActive,
	}: {
		playlist: SavedPlaylist;
		store: ReturnType<typeof createPlaylistStore>;
		/** The room to queue into — always the one this panel is open in. */
		slug: string;
		/** Room playlists only: offers "Set active" in the menu. */
		roomScoped: boolean;
		/** Rename, delete and remove-a-track: the coach's and the owner's on a
		 * room playlist (#771), always yours on a personal one. */
		canManage: boolean;
		onSetActive?: () => void;
	} = $props();

	let open = $state(false);
	let tracks = $state<SavedTrack[] | null>(null);
	let renaming = $state(false);
	let name = $state('');
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

	async function addTrack(command: JukeboxCommand) {
		error = null;
		const res = await store.addTrack(playlist.id, command);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		await load();
	}

	// Reorder (#1428) lives in the track's menu, like the queue's own moves
	// (#661): the row is too narrow for arrows beside a readable title.
	async function moveTrack(trackId: string, index: number) {
		const message = await store.moveTrack(playlist.id, trackId, index);
		if (message) {
			error = message;
			return;
		}
		await load();
	}

	function trackMenu(track: SavedTrack, i: number): MenuEntry[] {
		const entries: MenuEntry[] = [];
		const last = (tracks?.length ?? 0) - 1;
		if (i > 0)
			entries.push({
				label: 'Move up',
				icon: ArrowUp,
				onSelect: () => void moveTrack(track.id, i - 1),
			});
		if (i < last)
			entries.push({
				label: 'Move down',
				icon: ArrowDown,
				onSelect: () => void moveTrack(track.id, i + 1),
			});
		if (canManage)
			entries.push('separator', {
				label: 'Remove',
				icon: Trash2,
				onSelect: () => void removeTrack(track.id),
				danger: true,
			});
		return entries;
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
		];
		if (!canManage) return entries;
		entries.push({
			label: 'Rename',
			icon: Pencil,
			onSelect: () => (renaming = true),
		});
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

<!-- A row, not a card (#1423): the queue's rows above it have no border, and
     a bordered box per playlist was the one thing in the column drawn as an
     object of its own. Same left edge as the queue rows. -->
<li class="min-w-0" {@attach contextMenu(menu)}>
	<div class="flex min-w-0 items-center gap-2 py-1">
		<button
			onclick={toggle}
			aria-expanded={open}
			aria-label={open ? 'hide tracks' : 'show tracks'}
			class="text-muted hover:text-ink grid h-9 w-6 shrink-0 place-items-center"
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
		<!-- Folded open the way a queued set opens (JukeboxTrack): indented
		     under its row on a hairline, not boxed. -->
		<div class="border-muted/20 mt-1 mb-1.5 ml-3 min-w-0 border-l pl-3">
			{#if tracks === null}
				<p class="text-muted text-[11px]">Loading…</p>
			{:else if tracks.length === 0}
				<p class="text-muted text-[11px]">
					No tracks yet — search your library or paste a link below.
				</p>
			{:else}
				<ul class="flex flex-col gap-1">
					{#each tracks as track, i (track.id)}
						<li
							class="group flex min-w-0 items-center gap-1.5"
							{@attach contextMenu(() => trackMenu(track, i))}
						>
							{#if track.trackId}
								<!-- A library entry: the mark the queue's own rows use. -->
								<div
									class="bg-surface text-muted grid h-6 w-11 shrink-0 place-items-center rounded"
								>
									<Music size={11} />
								</div>
							{:else}
								<img
									src={thumbnailFor(track.videoId)}
									alt=""
									loading="lazy"
									referrerpolicy="no-referrer"
									class="bg-surface h-6 w-11 shrink-0 rounded object-cover"
								/>
							{/if}
							<span class="min-w-0 flex-1 truncate text-[11px]"
								>{track.playlistTitle ?? track.title}{#if track.artist}<span
										class="text-muted"
									>
										· {track.artist}</span
									>{/if}</span
							>
							{#if track.tracks?.length}
								<span
									class="text-muted shrink-0 font-mono text-[9px] tabular-nums"
									>{track.tracks.length}</span
								>
							{/if}
							{#if canManage}
								<button
									onclick={() => void removeTrack(track.id)}
									aria-label="remove this track"
									class="text-muted hover:text-danger grid h-6 w-6 shrink-0 place-items-center opacity-0 group-hover:opacity-100"
									><X size={12} /></button
								>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<div class="mt-2 flex min-w-0 flex-col gap-1.5">
				<JukeboxAdd
					send={(command) => void addTrack(command)}
					refusal={error}
					verb="Saved"
				/>
			</div>
		</div>
	{/if}

	<!-- The add box shows the refusal while the row is open; closed, it
	     has to be said here. -->
	{#if error && !open}<p class="text-danger pb-1 text-[11px]">{error}</p>{/if}
</li>
