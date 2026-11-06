<script lang="ts">
	import type { PlaceAddress } from '$lib/channel/address';
	import { account } from '$lib/account.svelte';
	import type {
		JukeboxCommand,
		JukeboxEntry,
		JukeboxState,
	} from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';
	import JukeboxAdd from '$lib/channel/JukeboxAdd.svelte';
	import Sofa from '@lucide/svelte/icons/sofa';
	import JukeboxDeck from '$lib/channel/JukeboxDeck.svelte';
	import JukeboxPlaylists from '$lib/channel/JukeboxPlaylists.svelte';
	import JukeboxTrack from '$lib/channel/JukeboxTrack.svelte';
	import { roadsideShown } from '$lib/channel/RoadsideDeck.svelte';
	import { IN_SYNC_SEC, playerInfo } from '$lib/channel/jukebox-player.svelte';
	import { listening } from '$lib/channel/listening.svelte';
	import {
		createPlaylistStore,
		type SaveTarget,
	} from '$lib/channel/playlists.svelte';
	import {
		saveEntryTo,
		saveQueueAsPlaylist,
	} from '$lib/channel/save-to-playlist';

	// The jukebox PLAYLIST (#23, #216, #286): what's on, what's next, what
	// just played, and every verb for changing it. The player itself is
	// JukeboxDock, docked on the app frame so music follows the connection —
	// this component never touches an iframe, and what is on the deck right
	// now draws itself (JukeboxDeck).

	let {
		jukebox,
		send,
		address,
		refusal = null,
		targetRpm = 0,
		riding = false,
	}: {
		jukebox: JukeboxState | undefined;
		send: (command: JukeboxCommand) => void;
		/** Where this deck stands — its shelf and its queue (#2449). */
		address: PlaceAddress;
		refusal?: string | null;
		/** The running block's cadence, from the tick (#1431). */
		targetRpm?: number;
		/** A ride is under way: no watt, riding-size targets. The layout
		 *  stays the desk's (#4347). */
		riding?: boolean;
	} = $props();

	const current = $derived(jukebox?.current);
	const queue = $derived(jukebox?.queue ?? []);
	const history = $derived(jukebox?.history ?? []);
	const inSync = $derived(Math.abs(playerInfo.drift) <= IN_SYNC_SEC);

	// House radio (ADR-0094, #4305): one switch queues it, as a song would
	// be, and takes every copy off again.
	const cozyOn = $derived(!!current?.radio);
	const cozy = $derived(cozyOn || queue.some((e) => e.radio));
	function toggleCozy() {
		if (!cozy) {
			send({ action: 'add', radio: true });
			return;
		}
		for (const entry of queue)
			if (entry.radio) send({ action: 'remove', entryId: entry.id });
		if (current?.radio) send({ action: 'skip' });
	}

	function move(entryId: string, from: number, by: number) {
		send({ action: 'move', entryId, index: from + by });
	}

	// Removing is reversible for ~10s (#660, errors.md prefers undo over
	// confirm): the server keeps what it just dropped, and `restore` puts it
	// back exactly where it left off. The toast IS the confirmation — nobody
	// has to answer a dialog before the queue moves on.
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
	const crewStore = $derived.by(() => createPlaylistStore(address.playlists));
	const mineStore = createPlaylistStore('/api/playlists');
	const saveTargets = $derived<SaveTarget[]>([
		...crewStore.all.map((p) => ({
			id: p.id,
			name: p.name,
			kind: 'crew' as const,
		})),
		...mineStore.all.map((p) => ({
			id: p.id,
			name: p.name,
			kind: 'mine' as const,
		})),
	]);

	const saveEntry = (entry: JukeboxEntry, target: SaveTarget) =>
		saveEntryTo(target.kind === 'crew' ? crewStore : mineStore, target, entry);

	// The deck and everything behind it, as a new crew playlist named for
	// today.
	let savingQueue = $state(false);
	async function saveQueue() {
		const entries = [...(current ? [current] : []), ...queue];
		if (!entries.length) return;
		savingQueue = true;
		await saveQueueAsPlaylist(crewStore, entries);
		savingQueue = false;
	}

	// ── How much of the queue is on screen ───────────────────────────────────
	// Three lines of queue, the rest on request; history folded (#461): the
	// column is shared with the chat, and the chat loses every time.
	const QUEUE_PEEK = 3;
	let showAllQueue = $state(false);
</script>

<section class="flex min-w-0 flex-col gap-3">
	<!-- One layout riding or not (#4347): it opens in the now bar's popover,
	     where the riding seat's sheet opened off the bottom of the window. -->
	<div class="flex min-w-0 items-center justify-between gap-2">
		<span class="eyebrow">jukebox</span>
		<!-- On the bike, riding or beside a roadside deck: no watt (#4197). -->
		{#if current && jukebox?.playing && !playerInfo.live && !listening.out && !riding && !roadsideShown()}
			<!-- Proof everyone is together, in the one place riders look for it.
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
	<!-- Above the deck, so it is in reach while house radio plays and the
	     deck below it fills the panel (#4305). -->
	{#if address.channel}
		<button
			type="button"
			onclick={toggleCozy}
			aria-pressed={cozy}
			class="btn {cozy
				? 'btn-primary'
				: 'btn-secondary'} w-full justify-start gap-2"
			title={cozy
				? 'Take house radio off the deck'
				: 'Lofi made for your crew, for everyone here'}
			><Sofa size={15} />
			{cozyOn
				? 'House radio is on'
				: cozy
					? 'House radio is next'
					: 'House radio'}
		</button>
	{/if}

	{#if jukebox && current}
		<JukeboxDeck {jukebox} {current} {send} {riding} />
	{:else}
		<p class="text-muted text-xs leading-relaxed">
			Nothing is playing. Search your library or paste a YouTube link, and
			everyone hears it on the same second.
		</p>
	{/if}

	{@render below()}
</section>

{#snippet below()}
	<JukeboxAdd {send} {refusal} />

	{#if queue.length}
		<div class="min-w-0">
			<p class="eyebrow flex items-center justify-between">
				<span>up next</span>
				<span class="num">{queue.length}</span>
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
				<!-- The round trip ADR-0045 makes cheap: what everyone is hearing
				     tonight, kept as a crew playlist to come back to. -->
				<button
					onclick={() => void saveQueue()}
					disabled={savingQueue}
					class="btn-link ml-auto"
					title="the deck and everything behind it, as a new crew playlist"
					>Save as a playlist</button
				>
			</div>
			{#if !riding}
				<p class="text-muted-dim mt-1.5 text-[10px]">
					Votes float a track up the queue.
				</p>
			{/if}
		</div>
	{/if}

	<!-- What is saved comes after what is live (#1423): the queue is what the
	     channel is about to hear; the playlists are where it can reach next. -->
	<JukeboxPlaylists {address} {crewStore} {mineStore} />

	{#if history.length}
		<details class="min-w-0">
			<summary class="eyebrow cursor-pointer py-2 select-none"
				>just played · {history.length}</summary
			>
			<ul class="mt-1.5 flex flex-col gap-1.5">
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
{/snippet}
