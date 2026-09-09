<script lang="ts">
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import Music from '@lucide/svelte/icons/music';
	import Plus from '@lucide/svelte/icons/plus';
	import { listTracks, trackClock, type Track } from '$lib/music/pool';
	import type { JukeboxCommand } from '$lib/protocol';
	import {
		addIntent,
		queueResolvedPlaylist,
		queueVideo,
		readLink,
		type PastedLink,
	} from '$lib/room/jukebox-add';
	import {
		resolvePlaylist,
		type ResolvedPlaylist,
	} from '$lib/room/youtube-playlist';

	// One field for everything a rider can put on the deck (#1421): typing
	// searches their library and each hit queues with a tap, Enter queues the
	// top one; a pasted link queues a video or a whole playlist (#615) exactly
	// as before. The library used to be reachable only from the Music page,
	// a screen away from the room that wanted the song.
	let {
		send,
		refusal = null,
	}: {
		send: (command: JukeboxCommand) => void;
		refusal?: string | null;
	} = $props();

	let text = $state('');
	let addError = $state<string | null>(null);
	let addNote = $state<string | null>(null);

	// A link that names a video AND the playlist it sits in: only the person
	// who pasted it knows which they meant, so ask. There is no answer 95 %
	// of riders would pick, which is what makes this a question, not a
	// setting — and no "remember this", for the same reason.
	let asking = $state<Extract<PastedLink, { kind: 'both' }> | null>(null);
	let set = $state<ResolvedPlaylist | null>(null);
	let setError = $state<string | null>(null);
	let busy = $state(false);

	// ── The library half ─────────────────────────────────────────────────────
	// Six hits: the column is shared with the chat, and a rider who wants the
	// seventh types one more letter. `searched` is the query the hits belong
	// to, so a slow answer never lands under a newer question.
	const HITS = 6;
	let hits = $state<Track[]>([]);
	let searched = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	function search(next: string) {
		text = next;
		clearTimeout(timer);
		if (addIntent(next) !== 'search') {
			hits = [];
			searched = '';
			return;
		}
		timer = setTimeout(() => void find(next.trim()), 200);
	}

	async function find(q: string) {
		const res = await listTracks(q);
		if (text.trim() !== q) return;
		hits = res.ok ? res.data.tracks.slice(0, HITS) : [];
		searched = q;
	}

	function queueTrack(track: Track) {
		send({
			action: 'add',
			trackId: track.id,
			title: track.title,
			artist: track.artist,
		});
		addNote = `Queued “${track.title}”.`;
	}

	function reset() {
		text = '';
		hits = [];
		searched = '';
		asking = null;
		set = null;
		setError = null;
	}

	// ── The link half ────────────────────────────────────────────────────────
	/** Read the playlist the moment one is in play, so the choice can say how
	 *  long it is — "the whole playlist" is not a decision until you know. */
	async function readSet(playlistId: string): Promise<ResolvedPlaylist | null> {
		setError = null;
		try {
			const resolved = await resolvePlaylist(playlistId);
			if (!resolved.tracks.length) throw new Error('empty');
			return resolved;
		} catch {
			setError =
				'That playlist could not be read — it may be private, unlisted or empty.';
			return null;
		}
	}

	function queueSet(resolved: ResolvedPlaylist) {
		queueResolvedPlaylist(resolved, send);
		addNote = resolved.truncated
			? `Queued the first ${resolved.tracks.length} tracks — the player reads no further into a playlist.`
			: null;
		reset();
	}

	async function submit() {
		addError = null;
		addNote = null;
		const q = text.trim();
		if (addIntent(q) === 'search') {
			// Enter on a search queues the top hit — after the answer, if the
			// debounce has not fired yet.
			clearTimeout(timer);
			if (searched !== q) await find(q);
			if (hits.length) {
				queueTrack(hits[0]);
				reset();
			} else {
				addError = `Nothing in your library matches “${q}”. Paste a YouTube link to add anything else.`;
			}
			return;
		}
		const link = readLink(q);
		if (link.kind === 'error') {
			addError = link.message;
			return;
		}
		if (link.kind === 'video') {
			await queueVideo(link.videoId, link.startSec, send);
			reset();
			return;
		}
		if (link.kind === 'both') {
			// Ask, and start reading the playlist behind the question.
			asking = link;
			set = null;
			void readSet(link.playlistId).then((r) => {
				if (asking?.playlistId === link.playlistId) set = r;
			});
			return;
		}
		busy = true;
		const resolved = await readSet(link.playlistId);
		busy = false;
		if (!resolved) {
			addError = setError;
			return;
		}
		queueSet(resolved);
	}

	/** The paster picked the playlist — it may still be resolving. */
	async function chooseSet() {
		if (!asking) return;
		if (set) return queueSet(set);
		busy = true;
		const resolved = await readSet(asking.playlistId);
		busy = false;
		if (resolved) queueSet(resolved);
	}

	async function chooseVideo() {
		if (!asking) return;
		await queueVideo(asking.videoId, asking.startSec, send);
		reset();
	}
</script>

<form
	class="flex min-w-0 gap-1.5"
	onsubmit={(e) => {
		e.preventDefault();
		void submit();
	}}
>
	<input
		value={text}
		oninput={(e) => search(e.currentTarget.value)}
		placeholder="Search your library, or paste a link…"
		class="input input-xs min-w-0 flex-1"
		aria-label="add music: search your library, or paste a YouTube link"
	/>
	<button
		disabled={!text.trim() || busy}
		class="btn btn-secondary btn-xs shrink-0 disabled:opacity-40"
		aria-label="add to the queue"><Plus size={14} /></button
	>
</form>

{#if hits.length}
	<!-- Inline, under the field: a tap per hit, the way the Music page's own
	     rows queue, and no dropdown to aim at mid-ride. -->
	<ul class="flex min-w-0 flex-col gap-1" aria-label="library matches">
		{#each hits as track (track.id)}
			<li class="flex min-w-0 items-center gap-1.5">
				<Music size={12} class="text-muted shrink-0" />
				<span class="min-w-0 flex-1 truncate text-[11px]">
					{track.title}{#if track.artist}<span class="text-muted">
							· {track.artist}</span
						>{/if}
				</span>
				<span class="text-muted shrink-0 font-mono text-[10px] tabular-nums"
					>{trackClock(track.durationMs)}</span
				>
				<button
					onclick={() => queueTrack(track)}
					class="btn btn-secondary btn-xs shrink-0"
					aria-label="Queue {track.title}"><ListPlus size={13} /></button
				>
			</li>
		{/each}
	</ul>
{:else if searched}
	<p class="text-muted text-[11px] leading-snug">
		Nothing in your library matches “{searched}”. Paste a YouTube link to add
		anything else.
	</p>
{/if}

{#if asking}
	<!-- Two big targets, inline: a modal mid-ride is a precision gesture with
	     extra steps. The playlist reads itself behind the question so the
	     button can say how much you would be queueing. -->
	<div class="border-neon/30 bg-surface min-w-0 rounded-lg border p-2">
		<p class="text-muted mb-2 text-[11px] leading-snug">
			That link sits inside a playlist.
		</p>
		<div class="flex min-w-0 gap-1.5">
			<button
				onclick={chooseVideo}
				disabled={busy}
				class="btn btn-secondary btn-xs min-w-0 flex-1 disabled:opacity-40"
				>Just this video</button
			>
			<button
				onclick={chooseSet}
				disabled={busy || !!setError}
				class="btn btn-secondary btn-xs min-w-0 flex-1 disabled:opacity-40"
			>
				{#if setError}The playlist{:else if set}The whole playlist · {set.tracks
						.length}{:else}The whole playlist…{/if}
			</button>
		</div>
		{#if setError}
			<p class="text-danger mt-1.5 text-[11px] leading-snug">{setError}</p>
		{/if}
	</div>
{/if}

{#if addError || refusal}<p class="text-danger text-xs">
		{addError ?? refusal}
	</p>{/if}
{#if addNote}<p class="text-muted text-[11px] leading-snug">{addNote}</p>{/if}
