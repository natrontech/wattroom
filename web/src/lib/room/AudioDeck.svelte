<script lang="ts">
	// A pool track on the deck (#267, ADR-0015): an <audio> element chasing the
	// same anchor the YouTube player chases, so one queue plays from two
	// sources without the room's clock knowing the difference.
	//
	// Its own component rather than a branch inside JukeboxDock: that file is
	// 576 lines of iframe lifecycle — buffering states, livestreams, blocked
	// autoplay, RMF geometry — and none of it applies here. Two players, one
	// anchor, switched by what is on the deck. `<audio>` needs no geometry at
	// all, which is the point: **RMF's tile rules bind only while a YouTube
	// entry plays** (WATTROOM.md), so a pool track is allowed to be heard and
	// not seen.
	//
	// Drift is corrected by assignment — `currentTime = target`. The seek-first
	// machinery in playhead.ts exists because an iframe seek lands on a
	// keyframe and reads back stale; a media element seeks where you tell it.
	import { mixer } from '$lib/sound/mixer.svelte';
	import { onDuck } from '$lib/sound/duck';
	import { playheadAt } from '$lib/room/playhead';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { serverNow } from '$lib/room/server-clock';
	import { listening } from '$lib/room/listening.svelte';

	/** Past this, assign rather than let it ride. SPEC's in-sync bar is 0.6 s. */
	const DRIFT_SEC = 0.6;

	const conn = $derived(roomConnection.current);
	const deck = $derived(conn?.live.tick?.jukebox);
	const track = $derived(deck?.current?.trackId ?? '');

	let audio = $state<HTMLAudioElement | null>(null);
	let loaded = $state('');
	let loadedAnchor = 0;
	// The room hears nothing from a rider sitting out, and neither does the
	// rider: unload rather than pause, so nothing streams to an empty chair.
	const silent = $derived(listening.out || mixer.muted);

	// Volume rides the mixer's music fader and the same duck every other
	// music source obeys — <audio> takes 0–1 where the iframe takes 0–100.
	$effect(() => {
		const el = audio;
		if (!el) return;
		const ceiling = silent ? 0 : mixer.music / 100;
		const depth = mixer.duck;
		return onDuck(({ down }) => {
			el.volume = Math.max(0, Math.min(1, down ? ceiling * depth : ceiling));
		});
	});

	// Chase on the tick: a media element needs no 250 ms timer of its own,
	// because assignment lands where it is told rather than on a keyframe.
	$effect(() => {
		const el = audio;
		const now = deck;
		if (!el || !now?.current?.trackId) return;

		// A repeat of the same track arrives with a new anchor — a new play,
		// not the one already loaded.
		if (loaded !== now.current.trackId || loadedAnchor !== now.anchorMs) {
			loaded = now.current.trackId;
			loadedAnchor = now.anchorMs;
			el.currentTime = playheadAt(now, serverNow());
		}

		if (!now.playing) {
			if (!el.paused) el.pause();
			// A scrub while paused moves the anchor and nothing else re-seeks
			// a stopped deck (#647).
			const target = playheadAt(now, serverNow());
			if (Math.abs(el.currentTime - target) > DRIFT_SEC)
				el.currentTime = target;
			return;
		}

		const target = playheadAt(now, serverNow());
		if (Math.abs(el.currentTime - target) > DRIFT_SEC) el.currentTime = target;
		// Autoplay can be refused before the rider has clicked anything; the
		// room's existing unblock path (#1062) is what recovers it, so this
		// simply does not throw.
		if (el.paused) void el.play().catch(() => {});
	});

	// Every client reports the end and the hub takes the first (#286): the
	// anchor match is what makes N reports advance the queue exactly once.
	function reportEnded() {
		const now = deck;
		if (!now?.current) return;
		conn?.live.jukebox({
			action: 'ended',
			trackId: now.current.trackId,
			anchorMs: now.anchorMs,
		});
	}
</script>

{#if track && !silent}
	<!-- No controls and nothing to look at: the deck's own UI owns the
	     transport, and this element exists to make a sound. -->
	<audio
		bind:this={audio}
		src="/api/tracks/{track}/audio"
		preload="auto"
		onended={reportEnded}
	></audio>
{/if}
