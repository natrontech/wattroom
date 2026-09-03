<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import type { JukeboxCommand } from '$lib/protocol';
	import {
		queueResolvedPlaylist,
		queueVideo,
		readLink,
		type PastedLink,
	} from '$lib/room/jukebox-add';
	import {
		resolvePlaylist,
		type ResolvedPlaylist,
	} from '$lib/room/youtube-playlist';

	// Paste a URL, the golden path — one video, or a whole playlist (#615).
	let { send }: { send: (command: JukeboxCommand) => void } = $props();

	let url = $state('');
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

	function reset() {
		url = '';
		asking = null;
		set = null;
		setError = null;
	}

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

	async function addFromUrl() {
		addError = null;
		addNote = null;
		const link = readLink(url);
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
		void addFromUrl();
	}}
>
	<input
		bind:value={url}
		placeholder="Add a YouTube link…"
		class="input input-xs min-w-0 flex-1"
		aria-label="add a track by link"
	/>
	<button
		disabled={!url.trim() || busy}
		class="btn btn-secondary btn-xs shrink-0 disabled:opacity-40"
		aria-label="add to the queue"><Plus size={14} /></button
	>
</form>

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

{#if addError}<p class="text-danger text-xs">{addError}</p>{/if}
{#if addNote}<p class="text-muted text-[11px] leading-snug">{addNote}</p>{/if}
