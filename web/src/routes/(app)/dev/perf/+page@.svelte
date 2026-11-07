<script lang="ts">
	import Mic from '@lucide/svelte/icons/mic';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { iceGathered } from '$lib/perf/ice-gathered';
	import Skyline from '$lib/ride/Skyline.svelte';
	import type { DioramaSky } from '$lib/world/look';
	import type { Road } from '$lib/road/road';
	import { sceneLoop } from '$lib/lounge/scene-loop';
	import { PLACES, drawScene, type Figure } from '$lib/lounge/scene';
	import { shadeFor } from '$lib/lounge/draw-room';
	import type { Moment, Visitor } from '$lib/lounge/moments';
	import { applyLoungeTheme, type Sky } from '$lib/lounge/palette';
	import { themeFor } from '$lib/themes';

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
		'skyline',
		'lounge',
		'world',
	];

	/** An invented road for the Skyline (#3059): 40 km of rolling hills, a
	 *  sample every 20 m. The dot moves a second at a time at `kph`, as a
	 *  ride's does, so the stepping between seconds is what gets measured. */
	const HILLS: Road = {
		length: 1999 * 20,
		heights: Array.from(
			{ length: 2000 },
			(_, i) => 500 + 80 * Math.sin(i / 40) + 30 * Math.sin(i / 13),
		),
		turns: Array(1999).fill(0),
	};
	const mps = Number(params.get('kph') ?? 25) / 3.6;
	let metre = $state(0);
	if (kase === 'skyline')
		setInterval(() => (metre = (metre + mps) % HILLS.length), 1000);

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

	/** The lounge as a desk's voice channel draws it (ADR-0094, #4302): a
	 *  640 × 260 room at twice its size, four on the sofa and three on
	 *  cushions around the rug, one riding, rain, a plane past the window, the disco ball
	 *  and a beat at 80 BPM — everything that moves in it at once. */
	const ROOM_W = Number(params.get('rw') ?? 640);
	const ROOM_H = Number(params.get('rh') ?? 260);
	const ROOM_SKY = (params.get('sky') ?? 'night') as Sky;
	const ROOM_LAMP = params.get('lamp') !== '0';
	const ROOM_FIRE = params.get('fire') !== '0';
	const SITTER: Figure = {
		id: 'a',
		name: 'A',
		skin: '#e0ac85',
		skinShade: '#c68a62',
		hair: '#2a1a12',
		hairStyle: 0,
		shirt: '#3de0d0',
		shirtShade: '#2a9a90',
		top: 1,
		stripes: true,
		pants: '#2b2350',
		pantsShade: '#1b1638',
		shoes: '#08010f',
		glasses: 1,
		scarf: '#d8404a',
		cushion: '#8a3a6a',
		speaking: false,
		muted: false,
		sounding: false,
		faded: false,
		cooling: params.get('cool') === '1',
	};
	function lounge(node: HTMLCanvasElement) {
		if (params.get('scheme') === 'light')
			applyLoungeTheme(themeFor('outrun', 'light'));
		let t = 0;
		return sceneLoop(
			node,
			(g, dt) => {
				t += dt;
				drawScene(g, {
					w: ROOM_W,
					h: ROOM_H,
					t,
					still: false,
					sky: ROOM_SKY,
					weather: 'rain',
					lampOn: ROOM_LAMP,
					crew: {
						seated: [0, 1, 2, 3].map((i) => ({
							...SITTER,
							id: String(i),
							speaking: i === 1,
							doing: (['read', 'sip', 'phone', 'nap'] as const)[i],
							emote: i === 0 ? (params.get('emote') ?? undefined) : undefined,
						})),
						floor: [
							[121, 130],
							[199, 130],
							[160, 156],
						].map(([x, y], i) => ({
							f: { ...SITTER, id: `f${i}`, speaking: i === 0 },
							x,
							y,
						})),
						placed: PLACES.filter((p) => params.get('placed')).map((p) => ({
							f: { ...SITTER, id: `p${p.seat}`, doing: p.doing },
							x: p.x,
							y: p.y,
						})),
						more: 0,
						bikes: [
							{
								x: 236,
								y: 135,
								face: -1,
								rider: { ...SITTER, id: 'r', watts: 210, crank: t * 9 },
							},
							{ x: 84, y: 135, face: 1 },
						],
					},
					playing: true,
					beat: (t * 80) / 60,
					pulsing: true,
					disco: params.get('disco') !== '0',
					// `cat=desk` puts it on the logbook; `cheer=1` has the first
					// sitter celebrate a level (standing.ts).
					cat: {
						...(params.get('cat') === 'desk'
							? { x: 34, y: 60 }
							: { x: 293, y: 40 }),
						pose: 'sleep',
						facing: 1,
						stride: 0,
					},
					catAwake: false,
					hearts: [],
					cheers:
						params.get('cheer') === '1'
							? [{ x: 285, y: 72, born: Math.floor(t / 3) * 3 }]
							: [],
					hours: 21,
					minutes: 30,
					cuckoo: false,
					shade: shadeFor(ROOM_LAMP, ROOM_SKY, ROOM_FIRE),
					flyby: { kind: 'plane', f: (t / 14) % 1, dir: 1 },
					mugDown: false,
					scratch: false,
					season: '',
					waveAt: -Infinity,
					radio: '',
					fishJump: false,
					bloom: false,
					arcade: false,
					fire: ROOM_FIRE,
					pizza: false,
					fondue: params.get('fondue') === '1',
					moment: (params.get('moment') ?? '') as Moment,
					visitor: params.get('visitor')
						? { kind: params.get('visitor') as Visitor, f: (t / 8) % 1 }
						: undefined,
					club: {
						plan: params.get('plan')
							? { day: 'THU', time: '18:30' }
							: undefined,
						pins: Number(params.get('pins') ?? 0),
						live: Number(params.get('live') ?? 0),
						sessions: Number(params.get('sessions') ?? 0),
						picks: Object.fromEntries(
							(params.get('picks') ?? '')
								.split(',')
								.filter(Boolean)
								.map((id) => [id.split('.')[0], id]),
						),
						initial: 'M',
						records: params.get('hiscore')
							? [{ initials: 'JAN', score: Number(params.get('hiscore')) }]
							: [],
						crowns: (params.get('crowns') ?? '').split(',').filter(Boolean),
						togetherSec: Number(params.get('together') ?? 0) * 3600,
						boardMetres: Number(params.get('km') ?? 0) * 1000,
						medals: Number(params.get('medals') ?? 0),
						polaroids: [...Array(Number(params.get('polaroids') ?? 0))].map(
							(_, i) => i + 2,
						),
					},
					owl: false,
				});
			},
			false,
		);
	}

	/** The ride's world, full screen as a ride draws it, for `make world-bench`
	 *  (#3082): the synthetic pass loop, you and three riders at 200 W, the
	 *  ride's own look; `light=1` is the World control's Light, `pixels=0` or
	 *  `pixels=d` sets the 3D look (Smooth or Diorama 3D) before it mounts,
	 *  `sky=night` and `weather=rain|snow` dress Diorama for the night and the room's weather,
	 *  `at=village` starts everyone 150 m before the loop's first village. The real
	 *  scene, imported here so no other case loads three.js. */
	function world(node: HTMLCanvasElement) {
		let scene: { dispose(): void } | undefined;
		let gone = false;
		void Promise.all([
			import('$lib/world/scene'),
			import('$lib/world/world'),
			import('$lib/world/look'),
			import('$lib/world/synthetic'),
			import('$lib/world/test-crew'),
			import('$lib/road/route'),
			import('$lib/world/mode'),
		]).then(
			([
				{ mount },
				{ generate },
				{ dioramaLook, rideLook, worldPaint },
				{ syntheticPoints },
				{ devCrew },
				{ toRoute },
				{ setWorldDiorama, worldDiorama },
			]) => {
				if (gone) return;
				const look = params.get('pixels');
				if (look !== null) setWorldDiorama(look !== '0');
				const route = toRoute(syntheticPoints());
				const world = generate(route);
				const at =
					params.get('at') === 'village'
						? Math.max(0, (world.villageNames[0]?.d ?? 150) - 150)
						: Number(params.get('at') ?? 0) || 0;
				const s = mount(node, {
					route,
					world,
					style: worldDiorama()
						? dioramaLook(worldPaint(node.parentElement ?? document.body), {
								night: params.get('sky') === 'night',
								weather:
									params.get('weather') === 'rain' ||
									params.get('weather') === 'snow'
										? params.get('weather')
										: 'clear',
							} as DioramaSky)
						: rideLook(worldPaint(node.parentElement ?? document.body)),
					ftp: 250,
					watts: 200,
					riders: devCrew(
						200,
						250,
						null,
						false,
						Number(params.get('crew') ?? 0),
					).map((r) => ({
						...r,
						d: r.d + at,
						at: r.at + at,
					})),
					light: params.get('light') === '1',
					onFail: (why) => console.error('world: stopped', why),
				});
				scene = s;
				Object.assign(window, {
					perfWorld: {
						probe: s.probe,
						frames: s.frames,
						stats: s.stats,
						setProgress: s.setProgress, // the light at a share of the ride, for a capture of the sky
						setCamera: s.setCamera, // heli, side, for a capture of the riders from every side
					},
				});
			},
		);
		return () => {
			gone = true;
			scene?.dispose();
		};
	}

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
					<Mic size={11} class="text-ok shrink-0 motion-safe:animate-pulse" />
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
		{:else if kase === 'skyline'}
			<!-- RoadRiding.svelte / FreeRide.svelte: the horizon on a road -->
			<div class="h-40 w-full">
				<Skyline road={HILLS} m={metre} {mps} />
			</div>
		{:else if kase === 'lounge'}
			<!-- LoungeScene.svelte's canvas at the scale a desk draws it -->
			<canvas
				width={ROOM_W}
				height={ROOM_H}
				class="[image-rendering:pixelated]"
				style:width="{ROOM_W * 2}px"
				style:height="{ROOM_H * 2}px"
				{@attach lounge}
			></canvas>
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

	{#if kase === 'world'}
		<!-- RideWorld.svelte: riding is the whole screen -->
		<canvas class="absolute inset-0 h-full w-full" {@attach world}></canvas>
	{/if}
</div>
