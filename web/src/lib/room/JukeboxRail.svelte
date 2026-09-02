<script lang="ts">
	import {
		FastForward,
		Pause,
		Play,
		Rewind,
		SkipForward,
		Volume2,
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { thumbnailFor } from '$lib/room/jukebox-add';
	import { MUSIC_FADER } from '$lib/sound/fader';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { IN_SYNC_SEC, playerInfo } from '$lib/room/jukebox-player.svelte';
	import { clampSeek, playheadAt } from '$lib/room/playhead';
	import { serverNow } from '$lib/room/server-clock';
	import { offerSeat, RAIL_SEAT } from '$lib/room/stage-slot.svelte';

	/**
	 * The player's home on the rail (#427). The people column holds it while
	 * that column is on screen; below xl there IS no people column, and off
	 * the room pages there never was one — so the rail carries the video and
	 * the transport, and the player stops being a window the rider has to
	 * park somewhere.
	 *
	 * RMF: ≥200×200 (the rail is 240 px wide, so the seat is squared off
	 * rather than 16:9), visible while media plays, nothing drawn over it —
	 * the title sits above the seat and the transport below it.
	 */
	const conn = $derived(roomConnection.current);
	const jukebox = $derived(conn?.live.tick?.jukebox);
	const current = $derived(jukebox?.current);
	const inSync = $derived(Math.abs(playerInfo.drift) <= IN_SYNC_SEC);
	// The room's own pages carry the people column at xl, and that column
	// outranks this seat — so the rail steps aside there rather than holding a
	// second 200 px hole the player will never fly into.
	const onRoomPage = $derived(page.url.pathname.startsWith('/r/'));

	// Every button commands the ROOM — the deck is shared.
	function transport(action: string) {
		conn?.live.jukebox({ action });
	}
	function nudge(seconds: number) {
		if (!jukebox?.current) return;
		conn?.live.jukebox({
			action: 'seek',
			positionSec: clampSeek(
				playheadAt(jukebox, serverNow(), playerInfo.duration) + seconds,
				playerInfo.duration,
			),
		});
	}
</script>

{#if current}
	<div
		class="border-ink/5 border-t px-3 pt-2.5 pb-1.5 {onRoomPage
			? 'xl:hidden'
			: ''}"
	>
		<div class="eyebrow flex min-w-0 items-center gap-1.5 pb-1.5">
			{#if jukebox?.playing && !playerInfo.live}
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full {inSync
						? 'bg-watt glow-stroke'
						: 'bg-muted animate-pulse'}"
					title={inSync
						? 'in sync with the room'
						: "catching up to the room's playhead"}
				></span>
			{/if}
			<span class="truncate normal-case">{current.title}</span>
		</div>

		<!-- The seat: the dock flies onto this hole. The art lies underneath so
		     that a moment with the player somewhere higher — the stage, TV mode
		     — leaves something to look at rather than a black box (#496). -->
		<div
			class="bg-surface relative w-full overflow-hidden rounded"
			style="height: 200px"
			{@attach (node) => offerSeat(node, RAIL_SEAT)}
		>
			<img
				src={thumbnailFor(current.videoId)}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				class="h-full w-full object-cover opacity-60"
			/>
		</div>

		<div class="text-muted flex items-center gap-0.5 pt-1">
			<button
				onclick={() => transport(jukebox?.playing ? 'pause' : 'play')}
				class="hover:text-ink shrink-0 rounded p-1"
				aria-label={jukebox?.playing
					? 'pause for the room'
					: 'play for the room'}
				title={jukebox?.playing ? 'pause for the room' : 'play for the room'}
			>
				{#if jukebox?.playing}<Pause size={13} />{:else}<Play size={13} />{/if}
			</button>
			{#if !playerInfo.live}
				<!-- A livestream has no timeline to jump around in. -->
				<button
					onclick={() => nudge(-30)}
					class="hover:text-ink shrink-0 rounded p-1"
					aria-label="back 30 seconds"
					title="back 30 seconds"><Rewind size={13} /></button
				>
				<button
					onclick={() => nudge(30)}
					class="hover:text-ink shrink-0 rounded p-1"
					aria-label="forward 30 seconds"
					title="forward 30 seconds"><FastForward size={13} /></button
				>
			{/if}
			<button
				onclick={() => transport('skip')}
				class="hover:text-ink shrink-0 rounded p-1"
				aria-label="skip for the room"
				title="skip for the room"><SkipForward size={13} /></button
			>
			<span class="bg-ink/10 mx-1 h-4 w-px shrink-0"></span>
			<Volume2 size={12} class="shrink-0" />
			<input
				type="range"
				{...MUSIC_FADER}
				value={mixer.music}
				oninput={(e) => mixer.setMusic(Number(e.currentTarget.value))}
				class="min-w-0 flex-1"
				aria-label="music volume, {mixer.music}%"
				title="music volume — {mixer.music}%"
			/>
		</div>
	</div>
{/if}
