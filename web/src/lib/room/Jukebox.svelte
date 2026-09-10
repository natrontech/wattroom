<script lang="ts">
	import FastForward from '@lucide/svelte/icons/fast-forward';
	import ListX from '@lucide/svelte/icons/list-x';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import Rewind from '@lucide/svelte/icons/rewind';
	import SkipBack from '@lucide/svelte/icons/skip-back';
	import SkipForward from '@lucide/svelte/icons/skip-forward';
	import HeadphoneOff from '@lucide/svelte/icons/headphone-off';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import { account } from '$lib/account.svelte';
	import { formatClockLong } from '$lib/format';
	import type { JukeboxCommand, JukeboxState } from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';
	import TrackWave from '$lib/room/TrackWave.svelte';
	import { thumbnailFor } from '$lib/room/jukebox-add';
	import JukeboxAdd from '$lib/room/JukeboxAdd.svelte';
	import JukeboxPlaylists from '$lib/room/JukeboxPlaylists.svelte';
	import JukeboxTrack from '$lib/room/JukeboxTrack.svelte';
	import {
		deckDuration,
		IN_SYNC_SEC,
		playerInfo,
	} from '$lib/room/jukebox-player.svelte';
	import { listening } from '$lib/room/listening.svelte';
	import {
		commandFromEntry,
		createPlaylistStore,
		type SaveTarget,
	} from '$lib/room/playlists.svelte';
	import type { JukeboxEntry } from '$lib/protocol';
	import { clampSeek, playheadAt } from '$lib/room/playhead';
	import { serverNow } from '$lib/room/server-clock';
	import { MUSIC_FADER } from '$lib/sound/fader';
	import { mixer } from '$lib/sound/mixer.svelte';
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
	const duration = $derived(deckDuration(current));
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

	// Every destructive deck verb below is reversible for ~10s (#660, errors.md
	// prefers undo over confirm): the server keeps what it just dropped, and
	// `restore` puts it back exactly where it left off. The toast IS the
	// confirmation — nobody has to answer a dialog before the room moves on.
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
	function skipPlaylist() {
		const title = current?.playlistTitle;
		send({ action: 'skipPlaylist' });
		toasts.push(`Skipped the rest of “${title}”.`, {
			undo: () => send({ action: 'restore' }),
		});
	}

	// ── Sitting out (#989) ───────────────────────────────────────────────────
	// Yours, not the room's: the deck's playhead is untouched and nothing is
	// sent. `stepOut` is handed the play and the length THIS client measured,
	// because the server holds an anchor and never a timeline.
	function stepOut(kind: 'skip' | 'stop') {
		listening.stepOut(
			kind,
			current
				? { videoId: current.videoId, anchorMs: jukebox!.anchorMs }
				: null,
			duration,
		);
	}

	// The deck's own transport, as a menu (#486) — every verb still has its
	// button below. Seek stays out: it needs a position, not a click.
	function deckMenu(): MenuEntry[] {
		const playing = !!jukebox?.playing;
		return [
			{
				label: playing ? 'Pause for everyone' : 'Play for everyone',
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
							onSelect: skipPlaylist,
						} satisfies MenuEntry,
					]
				: []),
			// Below the separator, everything is yours alone — "for me" and
			// "for everyone" are never adjacent (#989).
			'separator',
			...(listening.out
				? [
						{
							label: 'Rejoin the music',
							icon: Headphones,
							onSelect: () => listening.rejoin(),
						} satisfies MenuEntry,
					]
				: [
						{
							label: 'Skip this one for me',
							icon: Hourglass,
							onSelect: () => stepOut('skip'),
						} satisfies MenuEntry,
						{
							label: 'Stop the music for me',
							icon: HeadphoneOff,
							onSelect: () => stepOut('stop'),
						} satisfies MenuEntry,
					]),
		];
	}

	// ── Saving (#1427): a saved playlist is a saved queue (ADR-0045) ─────────
	// The stores live here, above both the rows that save into a list and
	// the panel that shows the lists, so one fetch serves both.
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

	async function saveEntry(entry: JukeboxEntry, target: SaveTarget) {
		const store = target.kind === 'room' ? roomStore : mineStore;
		const res = await store.addTrack(target.id, commandFromEntry(entry));
		toasts.push(
			res.ok
				? `Saved “${entry.playlistTitle ?? entry.title}” to “${target.name}”.`
				: res.error.message,
			res.ok ? undefined : { tone: 'error' },
		);
	}

	// The deck and everything behind it, as a new room playlist named for
	// today. Entries the server refuses — somebody else's library track —
	// are counted and said, not silently dropped.
	let savingQueue = $state(false);
	async function saveQueue() {
		const entries = [...(current ? [current] : []), ...queue];
		if (!entries.length) return;
		savingQueue = true;
		const name = `Up next · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
		const created = await roomStore.create(name);
		if (!created.ok) {
			savingQueue = false;
			toasts.push(created.error.message, { tone: 'error' });
			return;
		}
		let saved = 0;
		for (const entry of entries) {
			const res = await roomStore.addTrack(
				created.data!.id,
				commandFromEntry(entry),
			);
			if (res.ok) saved++;
		}
		savingQueue = false;
		const left = entries.length - saved;
		toasts.push(
			`Saved ${saved} track${saved === 1 ? '' : 's'} to “${name}”.` +
				(left
					? ` ${left} ${left === 1 ? 'was' : 'were'} somebody else's music and stayed out.`
					: ''),
		);
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
		{#if current && jukebox?.playing && !streaming && !listening.out}
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

	{#if current}
		<!-- Now playing, as a deck rather than a row: the art at the column's
		     width, the title under it, the playhead under that, the transport
		     under that. One thing per line reads at arm's length; a thumbnail
		     beside a truncated title and four identical grey buttons did not. -->
		<div class="flex min-w-0 flex-col gap-2.5" {@attach contextMenu(deckMenu)}>
			{#if current.trackId}
				<!-- A library track has no player to seat (#267): RMF's tile
				     rules bind only while a YouTube entry plays, so this one is
				     heard and not seen. Its waveform takes the seat instead
				     (#1425), at the same height, so the column does not jump
				     between sources. -->
				<div
					class="bg-surface w-full overflow-hidden rounded-lg px-2 py-6"
					style="height: clamp(200px, 24vh, 240px)"
				>
					<TrackWave trackId={current.trackId} progress={progress / 100} />
				</div>
			{:else}
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
			{/if}
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
				<!-- The watt on the dot, the words in ink (#1965): the accent is
				     a graphic at 3:1, not 10 px text. -->
				<p
					class="text-muted flex items-center gap-1.5 text-[10px] tracking-wider uppercase"
				>
					<span
						class="bg-watt glow-stroke h-1.5 w-1.5 rounded-full"
						aria-hidden="true"
					></span>
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
					class="text-muted hover:text-ink icon-btn"
					aria-label={setTracks
						? 'start this track over, or step back through the playlist'
						: 'start this track over'}><SkipBack size={17} /></button
				>
				{#if !streaming}
					<button
						onclick={() => seekTo(elapsed - 30)}
						class="text-muted hover:text-ink icon-btn"
						aria-label="back 30 seconds"><Rewind size={17} /></button
					>
				{/if}
				<button
					onclick={() => send({ action: jukebox?.playing ? 'pause' : 'play' })}
					class="bg-ink text-paper hover:bg-ink/90 icon-btn icon-btn-lg"
					aria-label={jukebox?.playing
						? 'pause for everyone'
						: 'play for everyone'}
					title={jukebox?.playing ? 'Pause for everyone' : 'Play for everyone'}
				>
					{#if jukebox?.playing}<Pause size={18} />{:else}<Play
							size={18}
							class="translate-x-px"
						/>{/if}
				</button>
				{#if !streaming}
					<button
						onclick={() => seekTo(elapsed + 30)}
						class="text-muted hover:text-ink icon-btn"
						aria-label="forward 30 seconds"><FastForward size={17} /></button
					>
				{/if}
				<button
					onclick={() => send({ action: 'skip' })}
					class="text-muted hover:text-ink icon-btn"
					aria-label={setTracks
						? 'skip to the next track in the playlist'
						: 'skip to the next track'}><SkipForward size={17} /></button
				>
				{#if setTracks}
					<!-- The escape hatch that makes a long playlist safe to queue:
					     drop the rest of it and move the room on. Only rendered
					     when there is a playlist to leave (ux.md). -->
					<button
						onclick={skipPlaylist}
						class="text-muted hover:text-ink icon-btn"
						aria-label="skip the whole playlist"><ListX size={17} /></button
					>
				{/if}
			</div>

			<!-- The one fader everybody reaches for, where the music is (#874) —
			     it used to be behind the Sound panel. Every button above it
			     commands the room; this one is your ears only, and says so. -->
			<label class="flex min-w-0 items-center gap-2">
				<Volume2 size={13} class="text-muted shrink-0" />
				<input
					type="range"
					{...MUSIC_FADER}
					value={mixer.music}
					oninput={(e) => mixer.setMusic(Number(e.currentTarget.value))}
					class="min-w-0 flex-1"
					aria-label="music volume, yours only — {mixer.music}%"
					title="music volume — yours only, {mixer.music}%"
				/>
				<span
					class="text-muted font-display w-8 shrink-0 text-right text-[10px] tabular-nums"
					>{mixer.music}%</span
				>
			</label>

			<!-- Still your ears, one line down: sitting out is a local decision
			     about a local player (#989, ADR-0018), so it belongs under the
			     fader and nowhere near the transport above it. Icons at the
			     transport's own size (#1423): two lines of text were the
			     smallest targets in the column, on the one row that is only
			     ever pressed mid-ride. Both verbs stay visible — the menu is
			     never the only way (ux.md). -->
			<div class="flex min-w-0 items-center justify-end gap-1 text-[11px]">
				{#if listening.out}
					<span class="text-muted min-w-0 flex-1 truncate"
						>{listening.mode === 'skip'
							? 'back on the next track'
							: 'the room is listening'}</span
					>
					<button
						onclick={() => listening.rejoin()}
						class="text-ink icon-btn"
						aria-label="rejoin the music"
						title="Rejoin — back in with the room, from wherever it has got to"
						><Headphones size={17} /></button
					>
				{:else}
					<span class="text-muted/70 min-w-0 flex-1 truncate">yours only</span>
					<button
						onclick={() => stepOut('skip')}
						class="text-muted hover:text-ink icon-btn"
						aria-label="skip this one for me"
						title="Skip for me — back automatically on the next track"
						><Hourglass size={17} /></button
					>
					<button
						onclick={() => stepOut('stop')}
						class="text-muted hover:text-ink icon-btn"
						aria-label="stop the music for me"
						title="Stop for me — the room keeps playing"
						><HeadphoneOff size={17} /></button
					>
				{/if}
			</div>
		</div>
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
			<p class="text-muted/70 mt-1.5 text-[10px]">
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
