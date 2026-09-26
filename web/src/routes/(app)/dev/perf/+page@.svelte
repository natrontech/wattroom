<script lang="ts">
	import Mic from '@lucide/svelte/icons/mic';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { iceGathered } from '$lib/perf/ice-gathered';

	/**
	 * One element at a time, for `make perf` (#3039): the harness in
	 * desktop/perf/ opens `?case=…` over a display and reads the GPU and CPU
	 * it costs. The backdrop is static and identical in every case, so what
	 * moves between two rows of the report is the case and nothing else.
	 *
	 * Components are the real ones. Where the app draws a mark as inline
	 * markup, the class string is the call site's, verbatim — the file it came
	 * from is named beside it, and a drift there is a stale number here.
	 */
	const params = page.url.searchParams;
	const kase = params.get('case') ?? 'none';
	const n = Number(params.get('n') ?? 1);

	const KNOWN = [
		'none',
		'riding-bars',
		'avatar-riding',
		'logo-live',
		'speaking-mic',
		'status-dot',
		'live-dot',
		'skeleton',
		'screen-share',
		'camera',
		'youtube',
	];

	/** Remote tracks arrive from /dev/perf/send, a separate renderer, so a
	 *  share costs this page its decode and draw and never its encode. */
	const pc = new RTCPeerConnection();
	let streams = $state<MediaStream[]>([]);
	pc.ontrack = (event) =>
		(streams = [...streams, new MediaStream([event.track])]);
	Object.assign(window, {
		perfAcceptOffer: async (offer: RTCSessionDescriptionInit) => {
			await pc.setRemoteDescription(offer);
			await pc.setLocalDescription();
			await iceGathered(pc);
			return pc.localDescription?.toJSON();
		},
		/** Did the video arrive, and how big: the harness turns two readings
		 *  into the frame rate it prints beside the numbers. */
		perfVideo: () =>
			[...document.querySelectorAll('video')].map((v) => ({
				size: `${v.videoWidth}x${v.videoHeight}`,
				frames: v.getVideoPlaybackQuality().totalVideoFrames,
			})),
	});

	function play(node: HTMLVideoElement, stream: MediaStream) {
		node.srcObject = stream;
	}

	// Dark unless asked: the glow only draws there (light-dark() makes it
	// transparent on white), and `theme=light` measures what that costs.
	document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
	document.title = KNOWN.includes(kase) ? 'perf:ready' : 'perf:unknown';
</script>

<div class="bg-surface text-ink fixed inset-0 overflow-hidden">
	<aside class="bg-surface-raised absolute inset-y-0 left-0 w-64 p-3">
		{#if kase === 'logo-live'}
			<!-- Sidebar.svelte, while your channel's session runs -->
			<div class="mb-2 px-1"><Logo size={22} live /></div>
		{/if}
		{#each { length: 22 } as _, i (i)}
			<div class="text-muted px-1 py-1.5 text-sm"># channel {i}</div>
		{/each}
	</aside>

	<aside class="bg-surface-raised absolute inset-y-0 right-0 w-72 p-3">
		{#each { length: 14 } as _, i (i)}
			<div class="text-muted flex items-center gap-2 px-1 py-1.5 text-sm">
				<Avatar
					name="Rider {i}"
					size={22}
					status={kase === 'avatar-riding' && i < n ? 'riding' : null}
				/>
				<span class="flex-1">Rider {i}</span>
				{#if kase === 'riding-bars' && i < n}<RidingBars />{/if}
				{#if kase === 'speaking-mic' && i < n}
					<!-- SidePanel.svelte, while the rider speaks -->
					<Mic size={11} class="text-z4 shrink-0 motion-safe:animate-pulse" />
				{/if}
			</div>
		{/each}
	</aside>

	<main
		class="absolute inset-y-0 right-72 left-64 flex flex-wrap content-start gap-4 p-6"
	>
		{#if kase === 'status-dot'}
			<!-- ChannelStatus.svelte -->
			<span
				class="bg-z5 h-2 w-2 shrink-0 rounded-full motion-safe:animate-pulse"
			></span>
		{:else if kase === 'live-dot'}
			<!-- (site)/+page.svelte, "live now" -->
			<span
				class="bg-watt glow-stroke h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
			></span>
		{:else if kase === 'skeleton'}
			<div class="flex w-[420px] flex-col gap-3">
				<Skeleton class="h-16" rows={n} />
			</div>
		{:else if kase === 'screen-share'}
			<!-- Stage.svelte's frame and zoom bar (`bar=0` drops the bar) -->
			<div
				class="ring-neon/40 relative w-full max-w-[1351px] overflow-hidden rounded-lg bg-black ring-1"
				style="aspect-ratio: 16 / 9"
			>
				{#each streams.slice(0, 1) as stream (stream.id)}
					<video
						class="h-full w-full object-contain"
						muted
						autoplay
						playsinline
						{@attach (node) => play(node, stream)}
					></video>
				{/each}
				{#if params.get('bar') !== '0'}
					<div
						class="bg-surface/80 ring-ink/10 absolute right-2 bottom-2 h-[52px] w-[290px] rounded-full ring-1 backdrop-blur"
					></div>
				{/if}
			</div>
		{:else if kase === 'camera'}
			{#each streams as stream (stream.id)}
				<div class="aspect-video w-[480px] overflow-hidden rounded-lg bg-black">
					<video
						class="h-full w-full object-cover"
						muted
						autoplay
						playsinline
						{@attach (node) => play(node, stream)}
					></video>
				</div>
			{/each}
		{:else if kase === 'youtube'}
			<!-- The jukebox player's shape; muted, and the harness mutes the process too -->
			<iframe
				title="YouTube"
				width={params.get('w') ?? 640}
				height={params.get('h') ?? 360}
				src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1&mute=1&controls=0&loop=1&playlist=aqz-KE-bpKQ"
				allow="autoplay; encrypted-media"
				referrerpolicy="strict-origin-when-cross-origin"
				class="border-0"
			></iframe>
		{/if}
	</main>
</div>
