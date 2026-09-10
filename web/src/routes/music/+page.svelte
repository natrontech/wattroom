<script lang="ts">
	// The music library (#268, ADR-0015 amended): your own uploaded tracks,
	// heard in every room you may enter — never shared with strangers. Browse
	// it, search it, drop MP3s on it, fix whatever the tags got wrong. Riders
	// read "library" everywhere (#1420); the code keeps calling it the pool.
	//
	// The rider's own playlists live here too (#1460): the library's home is
	// where a list of its tracks gets built, room or no room.
	import { confirm } from '$lib/confirm.svelte';
	import type { MenuEntry } from '$lib/context-menu.svelte';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ListMusic from '@lucide/svelte/icons/list-music';
	import {
		createPlaylistStore,
		type PlaylistStore,
	} from '$lib/room/playlists.svelte';
	import { saveToPlaylist } from '$lib/room/save-to-playlist';
	import { SvelteSet } from 'svelte/reactivity';
	import LibraryPicked from './LibraryPicked.svelte';
	import LibraryPlaylists from './LibraryPlaylists.svelte';
	import LibraryTrackRow from './LibraryTrackRow.svelte';
	import Music from '@lucide/svelte/icons/music';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Upload from '@lucide/svelte/icons/upload';
	import { account } from '$lib/account.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { presence } from '$lib/presence.svelte';
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import {
		deleteTrack,
		listTracks,
		parseTags,
		saveTrack,
		uploadTrack,
		whyNotUploadable,
		type PoolTag,
		type Track,
	} from '$lib/music/pool';

	let tracks = $state<Track[]>([]);
	let facets = $state<PoolTag[]>([]);
	// One tag at a time: the shelf a rider is standing at. '' is the whole pool.
	let tag = $state('');
	let loading = $state(true);
	let error = $state<string | null>(null);
	let query = $state('');
	let uploading = $state<string[]>([]);
	let editing = $state<string | null>(null);
	let dragging = $state(false);

	// All four states on every fetch (errors.md): loading, error-with-retry,
	// empty, content. `loading` only covers the first load of a given query —
	// re-searching swaps the list under a box the rider is still typing in,
	// and a skeleton flashing between keystrokes reads as breakage.
	async function load(q: string, showSkeleton = true) {
		if (showSkeleton) loading = true;
		const res = await listTracks(q, tag);
		loading = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		tracks = res.data.tracks;
		// Counted over the whole pool, so the row does not empty out as a rider
		// narrows — the other shelves are how they get back.
		facets = res.data.tags;
	}

	void load('');

	function pick(next: string) {
		tag = tag === next ? '' : next;
		void load(query, false);
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	function search(next: string) {
		query = next;
		clearTimeout(timer);
		// A pool of a few hundred tracks is a fast query; this is about not
		// firing one per keystroke, not about the server struggling.
		timer = setTimeout(() => void load(next, false), 200);
	}

	async function add(files: FileList | null) {
		if (!files?.length) return;
		for (const file of Array.from(files)) {
			const refusal = whyNotUploadable(file);
			if (refusal) {
				error = refusal;
				continue;
			}
			uploading = [...uploading, file.name];
			const res = await uploadTrack(file);
			uploading = uploading.filter((n) => n !== file.name);
			if (!res.ok) {
				error = res.error.message;
				continue;
			}
			error = null;
			// A track already in the pool comes back rather than duplicating, so
			// say which happened — silence would read as a failed upload.
			const already = tracks.some((t) => t.id === res.data.id);
			toasts.push(
				already
					? `“${res.data.title}” was already in your library.`
					: `Added “${res.data.title}”.`,
			);
			if (!already) tracks = [res.data, ...tracks];
		}
	}

	async function save(track: Track, fields: HTMLFormElement) {
		const data = new FormData(fields);
		const bpm = String(data.get('bpm') ?? '').trim();
		const res = await saveTrack(track.id, {
			title: String(data.get('title') ?? '').trim(),
			artist: String(data.get('artist') ?? '').trim(),
			album: String(data.get('album') ?? '').trim(),
			bpm: bpm === '' ? null : Number(bpm),
			tags: parseTags(String(data.get('tags') ?? '')),
		});
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		editing = null;
		tracks = tracks.map((t) => (t.id === track.id ? res.data : t));
		// An edit can mint a tag or retire the last track wearing one, so the
		// shelf labels come back from the server rather than being guessed at.
		void load(query, false);
	}

	// Undo over confirm is the rule (errors.md), but a delete here destroys the
	// file — there is nothing to undo to. That is the case the rule exempts.
	async function remove(track: Track) {
		const ok = await confirm({
			title: `Delete “${track.title}” from your library?`,
			body: 'The file goes with it. This cannot be undone.',
			action: 'Delete track',
			cancel: 'Keep it',
		});
		if (!ok) return;
		const res = await deleteTrack(track.id);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		tracks = tracks.filter((t) => t.id !== track.id);
		void load(query, false); // the last track wearing a tag takes it with it
	}

	// The room the rider is standing in: the connection outlives navigation
	// (#173), so browsing the shelf does not leave the room. Queuing anywhere
	// else would need a room picker, and a rider in one room wants that one.
	const room = $derived(roomConnection.current);
	// The rail knows the name; the connection holds only the slug.
	const roomName = $derived(
		room
			? (presence.rooms.find((r) => r.slug === room.slug)?.name ?? room.slug)
			: '',
	);

	// Save to a playlist (#1427): the rider's own lists always, the room's
	// when they are standing in one. One line per list in the menu.
	const mine = createPlaylistStore('/api/playlists');
	const roomLists = $derived(
		room ? createPlaylistStore(`/api/rooms/${room.slug}/playlists`) : null,
	);
	function saveTo(
		track: Track,
		store: PlaylistStore,
		id: string,
		name: string,
	): Promise<void> {
		return saveToPlaylist(
			store,
			{ id, name },
			{
				action: 'add',
				trackId: track.id,
				title: track.title,
				artist: track.artist,
			},
			track.title,
		);
	}

	function queue(track: {
		id: string;
		title: string;
		artist?: string;
		bpm?: number;
		durationMs?: number;
	}) {
		if (!room) return;
		room.live.jukebox({
			action: 'add',
			trackId: track.id,
			title: track.title,
			artist: track.artist,
			bpm: track.bpm,
			durationMs: track.durationMs,
		});
		toasts.push(`Queued “${track.title}”.`);
	}

	const owned = (track: Track) => track.uploadedBy === account.me?.displayName;

	// ── Multi-select (#1433) ──────────────────────────────────────────────────
	// A checkbox per row; what the ticked ones can do together is the bar
	// (LibraryPicked), which owns those verbs and the toasts they end in.
	const selected = new SvelteSet<string>();
	const picked = $derived(tracks.filter((t) => selected.has(t.id)));

	// Every object with more than one action gets a menu (ux.md, #465): the
	// buttons stay, the menu is the shortcut. Queue only when there is a room
	// to queue into, edit and delete only on your own rows — the same gating
	// the buttons have, so nothing in the menu can fail on click.
	function menu(track: Track): MenuEntry[] {
		const entries: MenuEntry[] = [];
		if (room)
			entries.push({
				label: `Queue in ${roomName}`,
				icon: ListPlus,
				onSelect: () => queue(track),
			});
		const targets = [
			...(roomLists?.all ?? []).map((p) => ({
				store: roomLists!,
				p,
				hint: roomName,
			})),
			...mine.all.map((p) => ({ store: mine, p, hint: 'yours' })),
		];
		if (targets.length) {
			if (entries.length) entries.push('separator');
			for (const { store, p, hint } of targets)
				entries.push({
					label: `Save to “${p.name}”`,
					icon: ListMusic,
					hint,
					onSelect: () => void saveTo(track, store, p.id, p.name),
				});
		}
		if (owned(track))
			entries.push(
				{ label: 'Edit', icon: Pencil, onSelect: () => (editing = track.id) },
				'separator',
				{
					label: 'Delete',
					icon: Trash2,
					danger: true,
					onSelect: () => void remove(track),
				},
			);
		return entries;
	}
</script>

<svelte:head><title>Music · WattRoom</title></svelte:head>

<main class="page">
	<header class="flex flex-wrap items-center gap-4">
		<h1 class="page-title">Music</h1>
		<p class="text-muted text-xs">
			Your own library. Everything here plays in any room you are in. 2 GB.
		</p>
		<label class="btn btn-primary ml-auto cursor-pointer">
			<Upload size={14} /> Add MP3s
			<input
				type="file"
				accept="audio/mpeg,.mp3"
				multiple
				class="hidden"
				onchange={(event) => {
					void add(event.currentTarget.files);
					event.currentTarget.value = '';
				}}
			/>
		</label>
	</header>

	<LibraryPlaylists store={mine} slug={room?.slug} />

	<label class="relative mt-4 block">
		<Search
			size={14}
			class="text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
		/>
		<input
			value={query}
			oninput={(event) => search(event.currentTarget.value)}
			placeholder="Search titles, artists, albums"
			aria-label="Search your library"
			class="input w-full pl-9"
		/>
	</label>

	<LibraryPicked
		{picked}
		slug={room?.slug}
		{roomName}
		{mine}
		{roomLists}
		onDone={() => selected.clear()}
	/>

	<!-- The shelf labels. Wide enough to scroll sideways in their own strip
	     rather than widening the page (ux.md, phone width). -->
	{#if facets.length}
		<div class="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
			{#each facets as facet (facet.tag)}
				<button
					onclick={() => pick(facet.tag)}
					aria-pressed={tag === facet.tag}
					class="shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors {tag ===
					facet.tag
						? 'border-neon bg-neon/15 text-fg'
						: 'border-muted/30 text-muted hover:border-neon/50'}"
				>
					{facet.tag}
					<span class="text-muted/70 ml-1 tabular-nums">{facet.tracks}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if error}
		<div class="mt-4">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load(query)} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{/if}

	<!-- Drop anywhere on the list, not just on a target: a rider dragging a
	     folder of MP3s should not have to aim. -->
	<div
		role="region"
		aria-label="Your library"
		ondragover={(event) => {
			event.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={(event) => {
			event.preventDefault();
			dragging = false;
			void add(event.dataTransfer?.files ?? null);
		}}
		class="mt-4 rounded-lg {dragging
			? 'outline-neon/70 outline-2 outline-dashed'
			: ''}"
	>
		{#each uploading as name (name)}
			<div class="panel text-muted mb-2 px-4 py-3 text-sm">
				Uploading {name}…
			</div>
		{/each}

		{#if loading}
			<Skeleton rows={5} class="mb-2 h-14" />
		{:else if tracks.length === 0 && tag}
			<EmptyState>
				{#snippet icon()}<Music
						size={20}
						class="text-muted/60 mb-2"
					/>{/snippet}
				<p class="text-sm">
					Nothing tagged “{tag}”{query ? ` matches “${query}”` : ''}.
				</p>
				{#snippet cta()}
					<button onclick={() => pick(tag)} class="btn btn-secondary"
						>Show the whole library</button
					>
				{/snippet}
			</EmptyState>
		{:else if tracks.length === 0 && query}
			<EmptyState>
				{#snippet icon()}<Music
						size={20}
						class="text-muted/60 mb-2"
					/>{/snippet}
				<p class="text-sm">Nothing here matches “{query}”.</p>
				<p class="text-muted mt-1 text-xs">
					Search runs over titles, artists and albums — and every one of those
					is editable, so a track with bad tags can be fixed rather than
					re-uploaded.
				</p>
			</EmptyState>
		{:else if tracks.length === 0}
			<EmptyState>
				{#snippet icon()}<Music
						size={20}
						class="text-muted/60 mb-2"
					/>{/snippet}
				<p class="text-sm">
					This is your library. Everything here plays in any room's jukebox,
					with no video tile in the way.
				</p>
				{#snippet cta()}
					<label class="btn btn-primary cursor-pointer">
						<Upload size={14} /> Add the first tracks
						<input
							type="file"
							accept="audio/mpeg,.mp3"
							multiple
							class="hidden"
							onchange={(event) => {
								void add(event.currentTarget.files);
								event.currentTarget.value = '';
							}}
						/>
					</label>
				{/snippet}
			</EmptyState>
		{:else}
			<ul class="space-y-2">
				{#each tracks as track (track.id)}
					<LibraryTrackRow
						{track}
						editing={editing === track.id}
						picked={selected.has(track.id)}
						owned={owned(track)}
						roomName={room ? roomName : null}
						menu={() => menu(track)}
						onPick={pick}
						onPicked={(on) =>
							on ? selected.add(track.id) : selected.delete(track.id)}
						onQueue={() => queue(track)}
						onEdit={() => (editing = track.id)}
						onCancel={() => (editing = null)}
						onSave={(fields) => void save(track, fields)}
						onDelete={() => void remove(track)}
					/>
				{/each}
			</ul>
			{#if !room}
				<!-- The page promises these play in a room; with none open there
				     is nothing to queue into, so it says how rather than drawing
				     a button that cannot work (ux.md). -->
				<p class="text-muted mt-3 text-xs">
					Open a room to queue any of these into its jukebox.
				</p>
			{/if}
		{/if}
	</div>
</main>
