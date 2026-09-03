<script lang="ts">
	import {
		FastForward,
		ListX,
		Pause,
		Play,
		Plus,
		Rewind,
		SkipBack,
		SkipForward,
	} from '@lucide/svelte';
	import { account } from '$lib/account.svelte';
	import { formatClockLong } from '$lib/format';
	import type { JukeboxCommand, JukeboxState } from '$lib/protocol';
	import {
		queueResolvedPlaylist,
		queueVideo,
		readLink,
		thumbnailFor,
		type PastedLink,
	} from '$lib/room/jukebox-add';
	import {
		resolvePlaylist,
		type ResolvedPlaylist,
	} from '$lib/room/youtube-playlist';
	import JukeboxTrack from '$lib/room/JukeboxTrack.svelte';
	import { IN_SYNC_SEC, playerInfo } from '$lib/room/jukebox-player.svelte';
	import { clampSeek, playheadAt } from '$lib/room/playhead';
	import { serverNow } from '$lib/room/server-clock';
	import {
		COLUMN_SEAT,
		offerSeat,
		stageSlot,
	} from '$lib/room/stage-slot.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';

	// The jukebox PLAYLIST (#23, #216, #286): what's on, what's next, what
	// just played, and every verb for changing it. The player itself is
	// JukeboxDock, docked on the app frame so music follows the connection —
	// this component never touches an iframe.

	let {
		jukebox,
		send,
	}: {
		jukebox: JukeboxState | undefined;
		send: (command: JukeboxCommand) => void;
	} = $props();

	// A stable attachment: a fresh arrow every render would tear the offer
	// down and re-register it on updates the seat has nothing to do with.
	const seat = (node: HTMLElement) => offerSeat(node, COLUMN_SEAT);

	// Something above the column is offering — the stage, or TV mode. The hole
	// is then a placeholder for a video already on screen, and the column has
	// three things fighting for its height (#504), so it stands down to the
	// words and the transport.
	const elsewhere = $derived(stageSlot.outranked);

	const current = $derived(jukebox?.current);
	const queue = $derived(jukebox?.queue ?? []);
	const history = $derived(jukebox?.history ?? []);

	// A playlist on the deck (#615) — an entry is one exactly when it carries
	// tracks, and it walks them without ever leaving its queue slot.
	const setTracks = $derived(current?.tracks?.length ?? 0);
	const setPosition = $derived((current?.index ?? 0) + 1);

	// ── The transport row (#114): the room's playhead, on server time. ───────
	let nowMs = $state(serverNow());
	$effect(() => {
		if (!current) return;
		// Dead-reckon locally between ticks (docs/SPEC.md) — a 1 Hz readout
		// on a shared playhead looks broken next to the music.
		const timer = setInterval(() => (nowMs = serverNow()), 250);
		return () => clearInterval(timer);
	});
	const duration = $derived(playerInfo.duration);
	/** A livestream has no timeline to scrub — the room rides the edge. */
	const streaming = $derived(playerInfo.live);
	const elapsed = $derived(
		jukebox?.current ? playheadAt(jukebox, nowMs, duration) : 0,
	);
	const progress = $derived(
		duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0,
	);
	const inSync = $derived(Math.abs(playerInfo.drift) <= IN_SYNC_SEC);

	function seekTo(pos: number) {
		send({ action: 'seek', positionSec: clampSeek(pos, duration) });
	}
	function move(entryId: string, from: number, by: number) {
		send({ action: 'move', entryId, index: from + by });
	}

	// The deck's own transport, as a menu (#486) — every verb still has its
	// button below. Seek stays out: it needs a position, not a click.
	function deckMenu(): MenuEntry[] {
		const playing = !!jukebox?.playing;
		return [
			{
				label: playing ? 'Pause' : 'Play',
				icon: playing ? Pause : Play,
				onSelect: () => send({ action: playing ? 'pause' : 'play' }),
			},
			{
				label: 'Back',
				icon: SkipBack,
				onSelect: () => send({ action: 'back' }),
			},
			{
				label: setTracks ? 'Skip this track' : 'Skip',
				icon: SkipForward,
				onSelect: () => send({ action: 'skip' }),
			},
			...(setTracks
				? [
						{
							label: 'Skip the whole playlist',
							icon: ListX,
							onSelect: () => send({ action: 'skipPlaylist' }),
						} satisfies MenuEntry,
					]
				: []),
		];
	}

	// ── Adding: paste a URL, the golden path ──────────────────────────────────
	// Three lines of queue, the rest on request; history folded (#461): the
	// column is shared with the chat, and the chat loses every time.
	const QUEUE_PEEK = 3;
	let showAllQueue = $state(false);
	let url = $state('');
	let addError = $state<string | null>(null);
	let addNote = $state<string | null>(null);

	// A link that names a video AND the playlist it sits in (#615): only the
	// person who pasted it knows which they meant, so ask. There is no 95 %
	// answer here, which is what makes this a question and not a setting.
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

<section class="flex min-w-0 flex-col gap-3">
	<div class="flex min-w-0 items-center justify-between gap-2">
		<span class="eyebrow">jukebox</span>
		{#if current && jukebox?.playing && !streaming}
			<!-- Proof the room is together, in the one place riders look for it. -->
			<span
				class="flex shrink-0 items-center gap-1.5 font-mono text-[10px] {inSync
					? 'text-watt'
					: 'text-muted'}"
			>
				<span
					class="h-1.5 w-1.5 rounded-full {inSync
						? 'bg-watt glow-stroke'
						: 'bg-muted animate-pulse'}"
				></span>
				{inSync ? 'in sync' : 'catching up'}
			</span>
		{/if}
	</div>

	{#if current}
		<!-- Now playing, as a deck rather than a row: the art at the column's
		     width, the title under it, the playhead under that, the transport
		     under that. One thing per line reads at arm's length; a thumbnail
		     beside a truncated title and four identical grey buttons did not. -->
		<div class="flex min-w-0 flex-col gap-2.5" {@attach contextMenu(deckMenu)}>
			<!-- The seat: the dock flies onto this hole (#445). ≥200 px tall so
			     the player clears RMF's 200×200 at the column's width, and the
			     height is clamped rather than tied to the panel's width — a
			     dragged-wide panel gave the picture 300 px and left the chat a
			     sliver (rider report).

			     The hole is ALWAYS MOUNTED, never rendered conditionally: the
			     stage taking the player and giving it back would then mount and
			     unmount this offer, which is what turned a pre-existing effect
			     loop fatal in 2026.09.9 (#494). When the stage or TV outranks
			     the column it is hidden instead — display:none, so the element
			     and its attachment stay put while the box stops costing the
			     column 200 px for a picture of a video already on screen (#504).

			     Hiding withdraws the offer, because a zero rect is not a seat.
			     That is wanted — the seat must never be won at zero height, or
			     the player flies into a sliver — and it is why `elsewhere` asks
			     whether a HIGHER surface is offering rather than who holds the
			     player. Hiding changes the holder, so deciding by holder closes
			     the loop: hidden, withdrawn, holder changes, shown again.
			     Measured, that was effect_update_depth_exceeded within a second
			     of the stage appearing. -->
			<div
				class="bg-surface relative w-full overflow-hidden rounded-lg {elsewhere
					? 'hidden'
					: ''}"
				style="height: clamp(200px, 24vh, 240px)"
				{@attach seat}
			>
				<img
					src={thumbnailFor(current.videoId)}
					alt=""
					loading="lazy"
					referrerpolicy="no-referrer"
					class="h-full w-full object-cover opacity-60"
				/>
				<span
					class="bg-paper/70 text-muted absolute inset-x-0 bottom-0 px-2 py-1 text-[10px]"
					>The player docks here.</span
				>
			</div>
			<!-- The hint sits on the words, never over the player (RMF). -->
			<div class="min-w-0" title={MENU_HINT}>
				{#if setTracks}
					<!-- Where the room is inside the set, before the track's own
					     name: the playlist is the thing that is on. -->
					<div class="mb-1 min-w-0">
						<p class="text-muted flex items-baseline gap-1.5 text-[11px]">
							<span class="truncate">{current.playlistTitle}</span>
							<span class="shrink-0 font-mono tabular-nums"
								>{setPosition}/{setTracks}</span
							>
						</p>
						<span class="bg-muted/20 mt-1 block h-0.5 rounded-full">
							<span
								class="bg-neon block h-full rounded-full"
								style="width: {(setPosition / setTracks) * 100}%"
							></span>
						</span>
					</div>
				{/if}
				<p class="truncate text-sm leading-tight font-medium">
					{current.title}
				</p>
				<p class="text-muted mt-0.5 truncate text-[11px]">
					{setTracks ? 'playlist queued by' : 'queued by'}
					{current.addedBy}
				</p>
			</div>

			{#if streaming}
				<p class="text-watt text-[10px] tracking-wider uppercase">
					live · playing at the stream edge
				</p>
			{:else}
				<div class="group min-w-0">
					<button
						onclick={(e) => {
							if (duration <= 0) return;
							const box = e.currentTarget.getBoundingClientRect();
							seekTo(((e.clientX - box.left) / box.width) * duration);
						}}
						class="block w-full cursor-pointer py-1.5"
						aria-label="seek the room's playhead"
					>
						<span class="bg-muted/20 block h-1.5 rounded-full">
							<span
								class="bg-watt relative block h-full rounded-full transition-[width] duration-200"
								style="width: {progress}%"
							>
								<span
									class="bg-watt glow-stroke absolute top-1/2 -right-1.5 h-3 w-3 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
								></span>
							</span>
						</span>
					</button>
					<div
						class="text-muted flex justify-between font-mono text-[10px] tabular-nums"
					>
						<span>{formatClockLong(elapsed)}</span>
						<span>{duration > 0 ? formatClockLong(duration) : '–:––'}</span>
					</div>
				</div>
			{/if}

			<!-- Mid-ride transport: big targets, no precision gestures. Play is the
			     one filled control; the rest are quiet. Every button commands the
			     ROOM — the deck is shared. -->
			<div class="flex min-w-0 flex-wrap items-center justify-center gap-1">
				<button
					onclick={() => send({ action: 'back' })}
					class="text-muted hover:text-ink grid h-10 w-10 place-items-center rounded-full"
					aria-label={setTracks
						? 'start this track over, or step back through the playlist'
						: 'start this track over'}><SkipBack size={17} /></button
				>
				{#if !streaming}
					<button
						onclick={() => seekTo(elapsed - 30)}
						class="text-muted hover:text-ink grid h-10 w-10 place-items-center rounded-full"
						aria-label="back 30 seconds"><Rewind size={17} /></button
					>
				{/if}
				<button
					onclick={() => send({ action: jukebox?.playing ? 'pause' : 'play' })}
					class="bg-ink text-paper hover:bg-ink/90 grid h-11 w-11 place-items-center rounded-full"
					aria-label={jukebox?.playing
						? 'pause for the room'
						: 'play for the room'}
				>
					{#if jukebox?.playing}<Pause size={18} />{:else}<Play
							size={18}
							class="translate-x-px"
						/>{/if}
				</button>
				{#if !streaming}
					<button
						onclick={() => seekTo(elapsed + 30)}
						class="text-muted hover:text-ink grid h-10 w-10 place-items-center rounded-full"
						aria-label="forward 30 seconds"><FastForward size={17} /></button
					>
				{/if}
				<button
					onclick={() => send({ action: 'skip' })}
					class="text-muted hover:text-ink grid h-10 w-10 place-items-center rounded-full"
					aria-label={setTracks
						? 'skip to the next track in the playlist'
						: 'skip to the next track'}><SkipForward size={17} /></button
				>
				{#if setTracks}
					<!-- The escape hatch that makes a long playlist safe to queue:
					     drop the rest of it and move the room on. Only rendered
					     when there is a playlist to leave (ux.md). -->
					<button
						onclick={() => send({ action: 'skipPlaylist' })}
						class="text-muted hover:text-ink grid h-10 w-10 place-items-center rounded-full"
						aria-label="skip the whole playlist"><ListX size={17} /></button
					>
				{/if}
			</div>
		</div>
	{:else}
		<p class="text-muted text-xs leading-relaxed">
			Nothing is playing. Paste a YouTube link — or drop one in the chat and
			queue it from there — and everyone hears it on the same second.
		</p>
	{/if}

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
		<!-- Two big targets, inline: a modal mid-ride is a precision gesture
		     with extra steps. The playlist reads itself behind the question so
		     the button can say how much you would be queueing. -->
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
					{#if setError}The playlist{:else if set}The whole playlist · {set
							.tracks.length}{:else}The whole playlist…{/if}
				</button>
			</div>
			{#if setError}
				<p class="text-danger mt-1.5 text-[11px] leading-snug">{setError}</p>
			{/if}
		</div>
	{/if}

	{#if addError}<p class="text-danger text-xs">{addError}</p>{/if}
	{#if addNote}<p class="text-muted text-[11px] leading-snug">{addNote}</p>{/if}

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
						onRemove={() => send({ action: 'remove', entryId: entry.id })}
					/>
				{/each}
			</ul>
			{#if queue.length > QUEUE_PEEK}
				<button
					onclick={() => (showAllQueue = !showAllQueue)}
					class="text-muted hover:text-ink mt-1.5 text-[11px] underline"
					>{showAllQueue
						? 'fewer'
						: `+${queue.length - QUEUE_PEEK} more`}</button
				>
			{/if}
			<p class="text-muted/70 mt-1.5 text-[10px]">
				Votes float a track up the queue.
			</p>
		</div>
	{/if}

	{#if history.length}
		<details class="min-w-0">
			<summary class="eyebrow cursor-pointer select-none"
				>just played · {history.length}</summary
			>
			<ul class="mt-1.5 flex flex-col gap-1.5 opacity-70">
				{#each history as entry (entry.id)}
					<JukeboxTrack
						{entry}
						onRequeue={() =>
							send({
								action: 'add',
								videoId: entry.videoId,
								title: entry.title,
							})}
					/>
				{/each}
			</ul>
		</details>
	{/if}
</section>
