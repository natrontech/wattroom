<script lang="ts">
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { playerInfo } from '$lib/room/jukebox-player.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';

	// THE jukebox player (#216): one iframe, docked on the app frame, alive
	// as long as the room connection is — music follows you between pages the
	// way voice does, every connected client reports 'ended', and ducking
	// works wherever you are. YouTube RMF: ≥200×200, visible while media
	// plays, nothing overlaid — a dock satisfies that on every page.

	const conn = $derived(roomConnection.current);
	const jukebox = $derived(conn?.live.tick?.jukebox);
	const ducked = $derived.by(() => {
		const speaking = conn?.av.speaking ?? {};
		return Object.entries(speaking).some(
			([id, active]) => active && id !== account.me?.id,
		);
	});

	let container = $state<HTMLDivElement | null>(null);

	// ── YouTube IFrame API ────────────────────────────────────────────────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type YtPlayer = any;
	let player: YtPlayer = null;
	let playerReady = $state(false);
	let apiFailed = $state(false);
	let loadedVideo: string | null = null;

	function withApi(cb: () => void) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const w = window as any;
		if (w.YT?.Player) return cb();
		const existing = w.onYouTubeIframeAPIReady;
		w.onYouTubeIframeAPIReady = () => {
			existing?.();
			cb();
		};
		if (!document.querySelector('script[src*="iframe_api"]')) {
			const tag = document.createElement('script');
			tag.src = 'https://www.youtube.com/iframe_api';
			document.head.appendChild(tag);
		}
	}

	$effect(() => {
		const node = container;
		if (!node || player) return;
		// A blocked iframe_api (adblock, corporate DNS) must say so instead of
		// rendering a silent black tile forever (#219).
		const failTimer = setTimeout(() => {
			if (!playerReady) apiFailed = true;
		}, 8_000);
		withApi(() => {
			clearTimeout(failTimer);
			if (player) return; // two queued callbacks must not build twice
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			player = new (window as any).YT.Player(node, {
				width: '100%',
				height: '100%',
				playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1 },
				events: {
					onReady: () => {
						playerReady = true;
						player.setVolume?.(Math.round(mixer.music));
					},
					onStateChange: (e: { data: number }) => {
						// 0 = ended: report it WITH the play epoch — the server
						// advances exactly once per (video, epoch).
						if (e.data === 0 && loadedVideo)
							conn?.live.jukebox(
								'ended',
								loadedVideo,
								undefined,
								undefined,
								undefined,
								conn?.live.tick?.jukebox?.anchorMs,
							);
					},
					onError: () => {
						// Non-embeddable or broken: skip for everyone rather than
						// leaving each rider staring at a different error.
						if (loadedVideo)
							conn?.live.jukebox(
								'ended',
								loadedVideo,
								undefined,
								undefined,
								undefined,
								conn?.live.tick?.jukebox?.anchorMs,
							);
					},
				},
			});
		});
		return () => {
			clearTimeout(failTimer);
			// The dock unmounts only when the connection ends — tear the
			// iframe down cleanly so a rejoin starts fresh.
			player?.destroy?.();
			player = null;
			playerReady = false;
			loadedVideo = null;
			playerInfo.duration = 0;
		};
	});

	// ── Ducking (#24, ramps per #152): dip under voice, wherever you are. ────
	let baseVolume = mixer.music;
	let releaseTimer: ReturnType<typeof setTimeout> | undefined;
	let rampTimer: ReturnType<typeof setInterval> | undefined;

	function rampTo(target: number, ms: number) {
		clearInterval(rampTimer);
		const from = player.getVolume?.() ?? target;
		const steps = Math.max(1, Math.round(ms / 30));
		let step = 0;
		rampTimer = setInterval(() => {
			step += 1;
			const v = from + ((target - from) * step) / steps;
			player.setVolume?.(Math.round(v));
			if (step >= steps) clearInterval(rampTimer);
		}, 30);
	}

	let wasDucked = false;
	$effect(() => {
		if (!playerReady) return;
		baseVolume = mixer.music; // the mixer owns the ceiling (#179)
		if (ducked) {
			wasDucked = true;
			clearTimeout(releaseTimer);
			rampTo(Math.round(baseVolume * 0.25), 150);
		} else if (wasDucked) {
			// The SPEC release: hold, then ramp back up.
			wasDucked = false;
			releaseTimer = setTimeout(() => rampTo(baseVolume, 400), 600);
		} else {
			// A fader move must act NOW — routing it through the release hold
			// made the slider feel dead (audit #219).
			player.setVolume?.(Math.round(baseVolume));
		}
		return () => {
			clearTimeout(releaseTimer);
			clearInterval(rampTimer);
		};
	});

	// ── Chase the server's playhead (tiered per the issue). ──────────────────
	$effect(() => {
		if (!playerReady) return;
		if (conn?.live.status !== 'live') {
			// No ticks, no chase: a stuck 1.25× nudge is worse than drift.
			player.setPlaybackRate?.(1);
			return;
		}
		if (!jukebox) return;
		const current = jukebox.current;
		if (!current) {
			if (loadedVideo) {
				player.stopVideo?.();
				loadedVideo = null;
				playerInfo.duration = 0;
			}
			return;
		}
		const target =
			jukebox.positionSec +
			(jukebox.playing ? (Date.now() - jukebox.anchorMs) / 1000 : 0);

		if (loadedVideo !== current.videoId) {
			loadedVideo = current.videoId;
			player.loadVideoById(current.videoId, target);
			return;
		}
		playerInfo.duration = player.getDuration?.() || 0;
		if (!jukebox.playing) {
			if (player.getPlayerState?.() === 1) player.pauseVideo();
			return;
		}
		if (player.getPlayerState?.() === 2) player.playVideo();

		const drift = target - (player.getCurrentTime?.() ?? 0);
		const abs = Math.abs(drift);
		if (abs > 2) player.seekTo(target, true);
		else if (abs > 0.3) player.setPlaybackRate(drift > 0 ? 1.25 : 0.75);
		else player.setPlaybackRate(1);
	});
</script>

{#if conn}
	<!-- In the room at xl+, slide left of the side panel — the dock must not
	     sit on the chat composer (#219). -->
	<div
		class="fixed bottom-4 z-[60] {jukebox?.current
			? ''
			: 'hidden'} {page.url.pathname.startsWith('/r/')
			? 'right-4 xl:right-[340px]'
			: 'right-4'}"
	>
		<!-- ≥200×200, always visible while media plays, nothing overlaid. -->
		<div
			class="ring-ink/15 relative overflow-hidden rounded-lg bg-black shadow-lg ring-1"
			style="width: 356px; height: 200px"
		>
			<div bind:this={container} class="h-full w-full"></div>
			{#if apiFailed}
				<div
					class="text-muted absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-xs"
				>
					The player could not load — a blocker may be stopping YouTube. The
					room's music continues for everyone else.
				</div>
			{/if}
		</div>
		{#if jukebox?.current}
			<p class="text-muted mt-1 max-w-[356px] truncate text-[10px]">
				{jukebox.current.title} · playing for the room
			</p>
		{/if}
	</div>
{/if}
