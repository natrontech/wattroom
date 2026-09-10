<script lang="ts">
	import { account } from '$lib/account.svelte';
	import type {
		JukeboxCommand,
		JukeboxEntry,
		JukeboxState,
	} from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';
	import JukeboxAdd from '$lib/room/JukeboxAdd.svelte';
	import JukeboxDeck from '$lib/room/JukeboxDeck.svelte';
	import JukeboxPlaylists from '$lib/room/JukeboxPlaylists.svelte';
	import JukeboxTrack from '$lib/room/JukeboxTrack.svelte';
	import { IN_SYNC_SEC, playerInfo } from '$lib/room/jukebox-player.svelte';
	import { listening } from '$lib/room/listening.svelte';
	import {
		createPlaylistStore,
		type SaveTarget,
	} from '$lib/room/playlists.svelte';
	import { saveEntryTo, saveQueueAsPlaylist } from '$lib/room/save-to-playlist';

	// The jukebox PLAYLIST (#23, #216, #286): what's on, what's next, what
	// just played, and every verb for changing it. The player itself is
	// JukeboxDock, docked on the app frame so music follows the connection —
	// this component never touches an iframe, and what is on the deck right
	// now draws itself (JukeboxDeck).

	let {
		jukebox,
		send,
		slug,
		refusal = null,
		targetRpm = 0,
	}: {
		jukebox: JukeboxState | undefined;
		send: (command: JukeboxCommand) => void;
		slug: string;
		refusal?: string | null;
		/** The running block's cadence, from the tick (#1431). */
		targetRpm?: number;
	} = $props();

	const current = $derived(jukebox?.current);
	const queue = $derived(jukebox?.queue ?? []);
	const history = $derived(jukebox?.history ?? []);
	const inSync = $derived(Math.abs(playerInfo.drift) <= IN_SYNC_SEC);

	function move(entryId: string, from: number, by: number) {
		send({ action: 'move', entryId, index: from + by });
	}

	// Removing is reversible for ~10s (#660, errors.md prefers undo over
	// confirm): the server keeps what it just dropped, and `restore` puts it
	// back exactly where it left off. The toast IS the confirmation — nobody
	// has to answer a dialog before the room moves on.
	function removeEntry(entry: {
		id: string;
		title: string;
		playlistTitle?: string;
	}) {
		send({ action: 'remove', entryId: entry.id });
		toasts.push(`Removed “${entry.playlistTitle ?? entry.title}”.`, {
			undo: () => send({ action: 'restore' }),
		});
	}

	// ── Saving (#1427): a saved playlist is a saved queue (ADR-0045) ─────────
	// The stores live here, above both the rows that save into a list and
	// the panel that shows the lists, so one fetch serves both. What a save
	// then does, and says, is save-to-playlist.ts.
	const roomStore = $derived.by(() =>
		createPlaylistStore(`/api/rooms/${slug}/playlists`),
	);
	const mineStore = createPlaylistStore('/api/playlists');
	const saveTargets = $derived<SaveTarget[]>([
		...roomStore.all.map((p) => ({
			id: p.id,
			name: p.name,
			kind: 'room' as const,
		})),
		...mineStore.all.map((p) => ({
			id: p.id,
			name: p.name,
			kind: 'mine' as const,
		})),
	]);

	const saveEntry = (entry: JukeboxEntry, target: SaveTarget) =>
		saveEntryTo(target.kind === 'room' ? roomStore : mineStore, target, entry);

	// The deck and everything behind it, as a new room playlist named for
	// today.
	let savingQueue = $state(false);
	async function saveQueue() {
		const entries = [...(current ? [current] : []), ...queue];
		if (!entries.length) return;
		savingQueue = true;
		await saveQueueAsPlaylist(roomStore, entries);
		savingQueue = false;
	}

	// ── How much of the queue is on screen ───────────────────────────────────
	// Three lines of queue, the rest on request; history folded (#461): the
	// column is shared with the chat, and the chat loses every time.
	const QUEUE_PEEK = 3;
	let showAllQueue = $state(false);
</script>

<section class="flex min-w-0 flex-col gap-3">
	<div class="flex min-w-0 items-center justify-between gap-2">
		<span class="eyebrow">jukebox</span>
		{#if current && jukebox?.playing && !playerInfo.live && !listening.out}
			<!-- Proof the room is together, in the one place riders look for it.
			     A rider who has stepped out is not with it and must not be told
			     they are: the badge goes, and comes back when they rejoin. -->
			<span
				class="flex shrink-0 items-center gap-1.5 font-mono text-[10px] {inSync
					? 'text-watt'
					: 'text-muted'}"
			>
				<span
					class="h-1.5 w-1.5 rounded-full {inSync
						? 'bg-watt glow-stroke'
						: 'bg-muted motion-safe:animate-pulse'}"
				></span>
				{inSync ? 'in sync' : 'catching up'}
			</span>
		{/if}
	</div>

	{#if jukebox && current}
		<JukeboxDeck {jukebox} {current} {send} />
	{:else}
		<p class="text-muted text-xs leading-relaxed">
			Nothing is playing. Search your library or paste a YouTube link, and
			everyone hears it on the same second.
		</p>
	{/if}

	<JukeboxAdd {send} {refusal} />

	{#if queue.length}
		<div class="min-w-0">
			<p class="eyebrow flex items-center justify-between">
				<span>up next</span>
				<span class="font-mono">{queue.length}</span>
			</p>
			<ul class="mt-1.5 flex flex-col gap-1.5">
				{#each queue.slice(0, showAllQueue ? queue.length : QUEUE_PEEK) as entry, i (entry.id)}
					<JukeboxTrack
						{entry}
						position={i + 1}
						myId={account.me?.id}
						onVote={() => send({ action: 'vote', entryId: entry.id })}
						onMove={queue.length > 1
							? (by) => move(entry.id, i, by)
							: undefined}
						onRemove={() => removeEntry(entry)}
						{saveTargets}
						onSave={(target) => void saveEntry(entry, target)}
						{targetRpm}
					/>
				{/each}
			</ul>
			<div class="mt-1.5 flex items-center gap-3 text-[11px]">
				{#if queue.length > QUEUE_PEEK}
					<button
						onclick={() => (showAllQueue = !showAllQueue)}
						class="btn-link"
						>{showAllQueue
							? 'fewer'
							: `+${queue.length - QUEUE_PEEK} more`}</button
					>
				{/if}
				<!-- The round trip ADR-0045 makes cheap: what the room is hearing
				     tonight, kept as a room playlist to come back to. -->
				<button
					onclick={() => void saveQueue()}
					disabled={savingQueue}
					class="btn-link ml-auto"
					title="the deck and everything behind it, as a new room playlist"
					>Save as a playlist</button
				>
			</div>
			<p class="text-muted-dim mt-1.5 text-[10px]">
				Votes float a track up the queue.
			</p>
		</div>
	{/if}

	<!-- What is saved comes after what is live (#1423): the queue is what the
	     room is about to hear; the playlists are where it can reach next. -->
	<JukeboxPlaylists {slug} {roomStore} {mineStore} />

	{#if history.length}
		<details class="min-w-0">
			<summary class="eyebrow cursor-pointer select-none"
				>just played · {history.length}</summary
			>
			<ul class="mt-1.5 flex flex-col gap-1.5 opacity-70">
				{#each history as entry (entry.id)}
					<!-- A pool track's row carries a trackId and no videoId (#267); the
					     hub takes the pool branch whenever one is set. Sending only the
					     videoId made the hub read it as a blank YouTube add (#1144). -->
					<JukeboxTrack
						{entry}
						onRequeue={() =>
							send({
								action: 'add',
								videoId: entry.videoId,
								trackId: entry.trackId,
								artist: entry.artist,
								title: entry.title,
								bpm: entry.bpm,
								durationMs: entry.durationMs,
							})}
						{saveTargets}
						onSave={(target) => void saveEntry(entry, target)}
					/>
				{/each}
			</ul>
		</details>
	{/if}
</section>
