<script lang="ts">
	// The music pool (#268, ADR-0015): one library the whole instance shares.
	// Browse it, search it, drop MP3s on it, fix whatever the tags got wrong.
	//
	// Playlists are not here yet — they need tables #1064 deliberately did not
	// create, and their naming is the decision #655 is sitting on.
	import Music from '@lucide/svelte/icons/music';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Upload from '@lucide/svelte/icons/upload';
	import { account } from '$lib/account.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { toasts } from '$lib/toast.svelte';
	import {
		deleteTrack,
		listTracks,
		saveTrack,
		trackClock,
		trackSize,
		uploadTrack,
		whyNotUploadable,
		type Track,
	} from '$lib/music/pool';

	let tracks = $state<Track[]>([]);
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
		const res = await listTracks(q);
		loading = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		tracks = res.data.tracks;
	}

	void load('');

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
					? `“${res.data.title}” was already in the pool.`
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
		});
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		editing = null;
		tracks = tracks.map((t) => (t.id === track.id ? res.data : t));
	}

	// Undo over confirm is the rule (errors.md), but a delete here destroys the
	// file — there is nothing to undo to. That is the case the rule exempts.
	async function remove(track: Track) {
		if (
			!confirm(`Delete “${track.title}” from the pool? This cannot be undone.`)
		)
			return;
		const res = await deleteTrack(track.id);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		tracks = tracks.filter((t) => t.id !== track.id);
	}

	const mine = (track: Track) => track.uploadedBy === account.me?.displayName;
</script>

<svelte:head><title>Music · WattRoom</title></svelte:head>

<main class="page">
	<header class="flex flex-wrap items-center gap-4">
		<h1 class="font-display text-2xl font-bold tracking-tight">Music</h1>
		<p class="text-muted text-xs">
			One library, shared by everyone here. 2 GB each.
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

	<label class="relative mt-4 block">
		<Search
			size={14}
			class="text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
		/>
		<input
			value={query}
			oninput={(event) => search(event.currentTarget.value)}
			placeholder="Search titles, artists, albums"
			aria-label="Search the music pool"
			class="input w-full pl-9"
		/>
	</label>

	{#if error}
		<div class="mt-4">
			<Banner tone="error">
				{error}
				<button
					onclick={() => void load(query)}
					class="btn btn-secondary btn-xs ml-3">Try again</button
				>
			</Banner>
		</div>
	{/if}

	<!-- Drop anywhere on the list, not just on a target: a rider dragging a
	     folder of MP3s should not have to aim. -->
	<div
		role="region"
		aria-label="Music pool"
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
					This is the crew's record shelf. Everything here plays in any room's
					jukebox, with no video tile in the way.
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
					<li class="panel px-4 py-3">
						{#if editing === track.id}
							<!-- Editable in place: real-world tags are garbage and
							     edit-beats-cleanup (ADR-0015). -->
							<form
								onsubmit={(event) => {
									event.preventDefault();
									void save(track, event.currentTarget);
								}}
								class="grid gap-2 sm:grid-cols-4"
							>
								<label class="block">
									<span class="eyebrow">title</span>
									<input
										name="title"
										value={track.title}
										required
										class="input mt-1 w-full"
									/>
								</label>
								<label class="block">
									<span class="eyebrow">artist</span>
									<input
										name="artist"
										value={track.artist ?? ''}
										class="input mt-1 w-full"
									/>
								</label>
								<label class="block">
									<span class="eyebrow">album</span>
									<input
										name="album"
										value={track.album ?? ''}
										class="input mt-1 w-full"
									/>
								</label>
								<label class="block">
									<span class="eyebrow">bpm</span>
									<input
										name="bpm"
										type="number"
										min="1"
										max="399"
										value={track.bpm ?? ''}
										placeholder="–"
										class="input mt-1 w-full font-mono tabular-nums"
									/>
								</label>
								<div class="flex gap-2 sm:col-span-4">
									<button type="submit" class="btn btn-primary btn-xs"
										>Save</button
									>
									<button
										type="button"
										onclick={() => (editing = null)}
										class="btn btn-secondary btn-xs">Cancel</button
									>
								</div>
							</form>
						{:else}
							<div class="flex items-center gap-4">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{track.title}</p>
									<p class="text-muted truncate text-xs">
										{track.artist || 'Unknown artist'}{track.album
											? ` · ${track.album}`
											: ''}
										{#if track.uploadedBy}· added by {track.uploadedBy}{/if}
									</p>
								</div>
								{#if track.bpm}
									<span
										class="border-muted/30 text-muted shrink-0 rounded border px-1.5 text-[10px] tabular-nums"
										title="beats per minute">{track.bpm} bpm</span
									>
								{/if}
								<span class="text-muted shrink-0 font-mono text-xs tabular-nums"
									>{trackClock(track.durationMs)}</span
								>
								<span class="text-muted hidden shrink-0 text-xs sm:inline"
									>{trackSize(track.sizeBytes)}</span
								>
								<!-- Capability gating (ux.md): somebody else's track shows no
								     controls rather than buttons that would 403. -->
								{#if mine(track)}
									<button
										onclick={() => (editing = track.id)}
										class="btn btn-secondary btn-xs shrink-0">Edit</button
									>
									<button
										onclick={() => void remove(track)}
										aria-label="Delete {track.title}"
										class="btn btn-danger btn-xs shrink-0"
										><Trash2 size={13} /></button
									>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
