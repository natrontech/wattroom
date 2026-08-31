<script lang="ts">
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
		withApi(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			player = new (window as any).YT.Player(node, {
				width: '100%',
				height: '100%',
				playerVars: { playsinline: 1, rel: 0 },
				events: {
					onReady: () => (playerReady = true),
					onStateChange: (e: { data: number }) => {
						// 0 = ended: report it; the server advances exactly once.
						if (e.data === 0 && loadedVideo)
							conn?.live.jukebox('ended', loadedVideo);
					},
					onError: () => {
						// Non-embeddable or broken: skip for everyone rather than
						// leaving each rider staring at a different error.
						if (loadedVideo) conn?.live.jukebox('ended', loadedVideo);
					},
				},
			});
		});
		return () => {
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

	$effect(() => {
		if (!playerReady) return;
		baseVolume = mixer.music; // the mixer owns the ceiling (#179)
		if (ducked) {
			clearTimeout(releaseTimer);
			rampTo(Math.round(baseVolume * 0.25), 150);
		} else {
			releaseTimer = setTimeout(() => rampTo(baseVolume, 400), 600);
		}
		return () => {
			clearTimeout(releaseTimer);
			clearInterval(rampTimer);
		};
	});

	// ── Chase the server's playhead (tiered per the issue). ──────────────────
	$effect(() => {
		if (!playerReady || !jukebox) return;
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

{#if conn && jukebox?.current}
	<div class="fixed right-4 bottom-4 z-30">
		<!-- ≥200×200, always visible while media plays, nothing overlaid. -->
		<div
			class="ring-ink/15 overflow-hidden rounded-lg bg-black shadow-lg ring-1"
			style="width: 356px; height: 200px"
		>
			<div bind:this={container} class="h-full w-full"></div>
		</div>
		<p class="text-muted mt-1 max-w-[356px] truncate text-[10px]">
			{jukebox.current.title} · playing for the room
		</p>
	</div>
{/if}
