<script lang="ts">
	import { audioSrc } from '$lib/music/pool';
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
	import { deckDuration, playerInfo } from '$lib/room/jukebox-player.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { trackFailureIsGlobal } from '$lib/room/playback-failure';

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
		if (!el || !now?.current?.trackId) {
			// The deck left the pool track, or this rider sat out: the seek bar
			// must not keep the length of a track that is no longer on it.
			if (loaded) {
				loaded = '';
				playerInfo.duration = 0;
				playerInfo.drift = 0;
			}
			return;
		}

		// A repeat of the same track arrives with a new anchor — a new play,
		// not the one already loaded.
		if (loaded !== now.current.trackId || loadedAnchor !== now.anchorMs) {
			// A different file: its length arrives with its metadata, and until
			// then the bar must not keep drawing the last track's. A repeat of
			// the same file reloads nothing, so its length simply stands.
			if (loaded !== now.current.trackId) playerInfo.duration = 0;
			loaded = now.current.trackId;
			loadedAnchor = now.anchorMs;
			el.currentTime = playheadAt(now, serverNow());
		}

		if (!now.playing) {
			if (!el.paused) el.pause();
			playerInfo.drift = 0;
			// A scrub while paused moves the anchor and nothing else re-seeks
			// a stopped deck (#647).
			const target = playheadAt(now, serverNow());
			if (Math.abs(el.currentTime - target) > DRIFT_SEC)
				el.currentTime = target;
			return;
		}

		const target = playheadAt(now, serverNow());
		playerInfo.drift = el.currentTime - target;
		// Only clients know how long a track is — the server holds an anchor,
		// not a timeline. A deck left playing to a room where nobody can
		// actually hear it runs its playhead off the end forever, because
		// `ended` fires on playback and playback never happened. Whoever
		// notices says the track is over, exactly as the YouTube path does.
		// The element's length once it has one; the server's (#1509) until
		// then, so a rider whose element never loaded still ends the track.
		const length =
			Number.isFinite(el.duration) && el.duration > 0
				? el.duration
				: deckDuration(now.current);
		if (length > 0 && target >= length) {
			reportEnded();
			return;
		}
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

	// The length is the element's to report — the server holds an anchor, not
	// a timeline — and the seek bar and the rail draw against it. Only the
	// YouTube dock used to say, so a pool track showed no progress (#1141).
	function measured() {
		const seconds = audio?.duration ?? 0;
		playerInfo.duration = Number.isFinite(seconds) ? seconds : 0;
	}

	// A track the server no longer has — deleted from the pool while it was on
	// the deck (#1132) — 404s, and the element fires `error` in place of
	// `ended`: nothing would ever say the play was over, and the whole room
	// sat on it. Same answer the dock gives an unplayable video: say so, and
	// report the end — the anchor makes every rider's report but the first
	// an echo.
	async function failed() {
		const title = deck?.current?.title ?? 'That track';
		// Gone for everyone, or this browser's own trouble (#1896)? One HEAD
		// says which; a network that cannot even answer is the latter.
		const status = await fetch(audioSrc(track), { method: 'HEAD' })
			.then((res) => res.status)
			.catch(() => 0);
		if (trackFailureIsGlobal(status)) {
			toasts.push(`“${title}” could not be played here — skipped.`);
			reportEnded();
			return;
		}
		toasts.push(
			`“${title}” could not be played here — the room plays on; you are back in on the next track.`,
		);
		const now = deck;
		if (now?.current)
			listening.stepOut(
				'skip',
				{ videoId: now.current.videoId, anchorMs: now.anchorMs },
				audio?.duration ?? 0,
			);
	}
</script>

{#if track && !silent}
	<!-- No controls and nothing to look at: the deck's own UI owns the
	     transport, and this element exists to make a sound. -->
	<audio
		bind:this={audio}
		src={audioSrc(track)}
		preload="auto"
		onended={reportEnded}
		onerror={failed}
		ondurationchange={measured}
	></audio>
{/if}
