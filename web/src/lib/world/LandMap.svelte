<script lang="ts">
	/**
	 * The map of one of WattRoom's designed lands (designs.ts LANDS: Wattalp,
	 * the Valley's Rahmental), as a game draws its island (Zwift's Watopia):
	 * its own picture, drawn once (map-render.ts, .claude/skills/render-map),
	 * the land in flat areas of the 3D world's colours; over it every road a
	 * thin dark line, the roundabouts small rings; and live, the loop you ride
	 * as a white line on top, bright ahead of you and faint behind, its start
	 * and finish, the places it rides through by name, and where you are.
	 * It shows the whole land, or `view`: the ride's Map zoomed to its loop,
	 * every name and mark as large on screen as on the whole land. North is up.
	 */
	import { untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { Tween } from 'svelte/motion';
	import { prefersReducedMotion } from '#lib/motion/index.ts';
	import { at } from '#lib/road/along.ts';
	import type { Route } from '#lib/road/route.ts';
	import { landBox, type LandMapOf, type MapBox } from './land-map';

	let {
		map,
		line,
		m,
		reverse = false,
		mates = [],
		you = 'watt',
		toGo,
		view,
		ticks = [],
	}: {
		/** The land's map (land-map.ts). */
		map: LandMapOf;
		/** The loop ridden, in the map's frame: a route this map's picture shows. */
		line: Route;
		/** Where you are: metres along `line`. */
		m: number;
		/** Ridden from the line's far end: ahead is toward metre 0. */
		reverse?: boolean;
		/** The riders around you: metres along `line`, and names. */
		mates?: { m: number; label: string }[];
		/** Your dot: watt where nothing else marks you, ink where the Skyline beside it does (the ride's G2); none where nobody rides (the Routes page). */
		you?: 'watt' | 'ink' | 'none';
		/** Kilometres to the finish, written by its flag. */
		toGo?: number;
		/** The part of the land shown (land-map.ts loopBox): the whole land where not given. */
		view?: MapBox;
		/** Kilometre markers: each its kilometre and its metres along `line`, drawn as large on screen at any zoom. */
		ticks?: { km: number; m: number }[];
	} = $props();
	const uid = $props.id();
	const MAP = $derived(map.data);
	/** Every mark drawn in the map's metres, this many times Wattalp's: a smaller land, drawn as large, reads alike. */
	const s = $derived(MAP.scale ?? 1);

	const path = (r: Route, from: number, to: number) => {
		const out: string[] = [];
		for (let d = from; d < to; d += 10) {
			const p = at(r, d);
			out.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
		}
		const p = at(r, to);
		out.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
		return `M${out.join('L')}`;
	};

	const here = $derived(at(line, m));
	const around = $derived(
		mates.map((mate) => ({ label: mate.label, ...at(line, mate.m) })),
	);
	const length = $derived(line.length);
	const at0 = $derived(Math.min(length, Math.max(0, m)));
	/** The way still to ride, and the way ridden. */
	const ahead = $derived(
		reverse ? (at0 > 0 ? path(line, 0, at0) : '') : path(line, at0, length),
	);
	const behind = $derived(
		reverse
			? at0 < length
				? path(line, at0, length)
				: ''
			: at0 > 0
				? path(line, 0, at0)
				: '',
	);
	const start = $derived(at(line, reverse ? length : 0));
	/** The places this loop rides through or over: only these are named. */
	const named = $derived.by(() => {
		const pts: [number, number][] = [];
		for (let d = 0; d <= length; d += 40) {
			const p = at(line, d);
			pts.push([p.x, p.z]);
		}
		return MAP.labels.filter((l) =>
			pts.some(([x, z]) => Math.hypot(x - l.x, z - l.z) < 250 * s),
		);
	});

	// The map's picture: its rectangle in the world's frame (x east, z south).
	const mx = $derived(MAP.bounds.west);
	const mz = $derived(-MAP.bounds.north);
	const mw = $derived(MAP.bounds.east - MAP.bounds.west);
	const mh = $derived(MAP.bounds.north - MAP.bounds.south);
	/** A road's strokes: drawn in screen pixels, whatever the map's size. */
	const PX = { 'vector-effect': 'non-scaling-stroke' } as const;
	// ...and those pixels as many as the map is tall: set for a map about 950 px tall, thinner on a smaller one. Wattalp's height is the map's: a land drawn at its scale reads as large.
	let cw = $state(0);
	let ch = $state(0);
	const k = $derived(
		cw > 0 && ch > 0
			? Math.min(1.3, Math.max(0.6, (Math.min(cw / mw, ch / mh) * mh) / 950))
			: 1,
	);

	// What the picture shows, gliding there when it changes: the whole land, or `view`.
	const shown = new Tween<MapBox>(
		untrack(() => view ?? landBox(MAP.bounds)),
		{ easing: cubicOut },
	);
	$effect(() => {
		void shown.set(view ?? landBox(MAP.bounds), {
			duration: prefersReducedMotion.current ? 0 : 350,
		});
	});
	const v = $derived(shown.current);
	/** A metre of the view on screen against one of the whole land's: every name and mark is drawn this much smaller in metres, so as large on screen. */
	const f = $derived(
		cw > 0 && ch > 0
			? Math.min(cw / mw, ch / mh) / Math.min(cw / v.w, ch / v.h)
			: Math.max(v.w / mw, v.h / mh),
	);
	/** A mark's metre: Wattalp's, at this land's scale and the view's. */
	const u = $derived(s * f);
	/**
	 * The names grow, zoomed in, to READ_PX on screen where the whole land's
	 * are smaller: read at arm's length, and never more than the zoom spreads
	 * the places apart, so names placed clear of each other stay clear.
	 */
	const READ_PX = 16;
	const r = $derived.by(() => {
		const px = MAP.type.village * Math.min(cw / mw, ch / mh);
		return px > 0 ? Math.min(1 / f, Math.max(1, READ_PX / px)) : 1;
	});
	/** A name's metre: the view's, and grown by `r`. */
	const tf = $derived(f * r);
	/** The names' font sizes, in the view's metres. */
	const T = $derived({
		village: MAP.type.village * tf,
		pass: MAP.type.pass * tf,
	});
	/** The scale bar's metres: as long on screen as two of Wattalp's kilometres on the whole land, rounded down to 1, 2 or 5 times a power of ten. */
	const bar = $derived.by(() => {
		const most = 2000 * u * (1 + 1e-9);
		const ten = 10 ** Math.floor(Math.log10(most));
		return ([5, 2, 1].find((n) => n * ten <= most) ?? 1) * ten;
	});
	/** The bar drawn in its group's units (a mark's metre). */
	const barLength = $derived(bar / u);
	/** A screen pixel in the view's metres: the km markers' unit. */
	const pxm = $derived(cw > 0 && ch > 0 ? 1 / Math.min(cw / v.w, ch / v.h) : u);
	const marks = $derived(ticks.map((t) => ({ km: t.km, ...at(line, t.m) })));
	const tick = (metres: number, last: boolean) =>
		bar >= 1000
			? `${metres / 1000}${last ? ' km' : ''}`
			: `${metres}${last ? ' m' : ''}`;
</script>

<div class="h-full w-full" bind:clientWidth={cw} bind:clientHeight={ch}>
	<svg
		viewBox="{v.x} {v.z} {v.w} {v.h}"
		class="h-full w-full"
		role="img"
		aria-label="the map of {MAP.name}{you === 'none'
			? ', and the loop on it'
			: ', and where you are on it'}"
		data-testid="map-overview"
	>
		<defs>
			<clipPath id="{uid}-frame">
				<rect x={mx} y={mz} width={mw} height={mh} />
			</clipPath>
			<filter id="{uid}-glow" x="-100%" y="-100%" width="300%" height="300%">
				<feGaussianBlur stdDeviation={70 * u} />
			</filter>
		</defs>
		<g clip-path="url(#{uid}-frame)">
			<image
				href={map.picture}
				x={mx}
				y={mz}
				width={mw}
				height={mh}
				preserveAspectRatio="none"
			/>
			<!-- Every road a thin dark line, as on a game's island map; a bridge
			     a pale stroke under it, a gallery dashed. -->
			<g fill="none" stroke-linejoin="round" stroke-linecap="round">
				<path
					d={MAP.roads.bridges}
					stroke="var(--world-px-prop-wall)"
					stroke-width={5 * k}
					stroke-linecap="butt"
					{...PX}
				/>
				<path
					d={MAP.roads.spurs}
					stroke="var(--world-px-road-asphalt)"
					stroke-opacity="0.8"
					stroke-width={1.4 * k}
					{...PX}
				/>
				<!-- A gravel lane finer, dashed: a farm track, not a road. -->
				<path
					d={MAP.roads.lanes ?? ''}
					stroke="var(--world-px-road-asphalt)"
					stroke-opacity="0.7"
					stroke-width={1 * k}
					stroke-dasharray="3 2"
					stroke-linecap="butt"
					{...PX}
				/>
				<path
					d={MAP.roads.loops}
					stroke="var(--world-px-road-asphalt)"
					stroke-width={2 * k}
					{...PX}
				/>
				<path
					d={MAP.roads.galleries}
					stroke="var(--world-px-prop-wall)"
					stroke-width={1.4 * k}
					stroke-dasharray="2 2"
					stroke-linecap="butt"
					{...PX}
				/>
				<!-- A tunnel: the road under the hill, its line broken. -->
				<path
					d={MAP.roads.tunnels ?? ''}
					stroke="var(--world-px-road-shoulder)"
					stroke-width={2.4 * k}
					stroke-dasharray="1.5 1.5"
					stroke-linecap="butt"
					{...PX}
				/>
				<!-- The loop you ride, a white line over them all: faint where you
				     have been, bright ahead. -->
				<path
					d={behind}
					stroke="var(--world-px-ridge)"
					stroke-opacity="0.4"
					stroke-width={4.2 * k}
					{...PX}
				/>
				<path
					d={behind}
					stroke="var(--world-px-road-line)"
					stroke-opacity="0.6"
					stroke-width={2.2 * k}
					{...PX}
				/>
				<path
					d={ahead}
					stroke="var(--world-px-ridge)"
					stroke-opacity="0.8"
					stroke-width={5.5 * k}
					{...PX}
				/>
				<path
					d={ahead}
					stroke="var(--world-px-road-line)"
					stroke-width={3.4 * k}
					{...PX}
				/>
			</g>
			<!-- The roundabouts: small rings. -->
			{#each MAP.rings as r (r.x)}
				<circle
					cx={r.x}
					cy={r.z}
					r={45 * u}
					fill="var(--world-px-biome-meadow)"
					stroke="var(--world-px-road-asphalt)"
					stroke-width={2 * k}
					{...PX}
				/>
			{/each}
			<!-- The places the loop rides, in white capitals with a soft dark
			     edge so they read on snow and meadow alike. -->
			<g
				class="font-display"
				fill="var(--world-px-road-line)"
				stroke="var(--world-px-ridge)"
				stroke-opacity="0.7"
				paint-order="stroke"
				stroke-linejoin="round"
				font-weight="700"
			>
				{#each named as l (l.kind + l.name)}
					{#if l.kind === 'pass'}
						<path
							d="M{l.x - 70 * u},{l.z + 50 * u}L{l.x},{l.z - 70 * u}L{l.x +
								70 * u},{l.z + 50 * u}Z"
							fill="var(--world-px-road-line)"
							stroke="var(--world-px-ridge)"
							stroke-width={20 * u}
						/>
					{:else}
						<circle
							cx={l.x}
							cy={l.z}
							r={45 * u}
							fill="var(--world-px-road-line)"
							stroke="var(--world-px-ridge)"
							stroke-width={20 * u}
						/>
					{/if}
					<text
						x={l.x + (l.tx - l.x) * tf}
						y={l.z + (l.tz - l.z) * tf}
						text-anchor={l.anchor}
						font-size={l.kind === 'pass' ? T.pass : T.village}
						letter-spacing={(l.kind === 'pass' ? T.pass : T.village) * 0.12}
						stroke-width={(l.kind === 'pass' ? T.pass : T.village) * 0.2}
						>{l.name.toUpperCase()}</text
					>
				{/each}
			</g>
			<!-- Start and finish: a chequered flag on its pole, beside the
			     roundabout rather than over it, and how far it is still: drawn at
			     Wattalp's size and scaled, so its type is Wattalp's too. -->
			<g transform="translate({start.x} {start.z}) scale({u})">
				<path
					d="M0,0V-420"
					stroke="var(--world-px-ridge)"
					stroke-width={2.5 * k}
					{...PX}
				/>
				<circle
					r="40"
					fill="var(--world-px-road-line)"
					stroke="var(--world-px-ridge)"
					stroke-width={1.5 * k}
					{...PX}
				/>
				{#each [0, 1, 2] as i (i)}
					{#each [0, 1] as j (j)}
						<rect
							x={i * 75}
							y={-420 + j * 75}
							width="75"
							height="75"
							fill={(i + j) % 2
								? 'var(--world-px-ridge)'
								: 'var(--world-px-road-line)'}
						/>
					{/each}
				{/each}
				{#if toGo !== undefined}
					<text
						data-testid="map-to-go"
						x="280"
						y="-280"
						class="font-display"
						font-size={(MAP.type.pass / s) * 1.15 * r}
						font-weight="700"
						fill="var(--world-px-road-line)"
						stroke="var(--world-px-ridge)"
						stroke-opacity="0.8"
						stroke-width={(MAP.type.pass / s) * 0.25 * r}
						paint-order="stroke"
						stroke-linejoin="round">{toGo.toFixed(1)} km to go</text
					>
				{/if}
			</g>
			<!-- The kilometres along the loop, as the road's outline marks them. -->
			<g class="font-display" font-weight="700">
				{#each marks as t (t.km)}
					<circle
						data-testid="map-km"
						cx={t.x}
						cy={t.z}
						r={9 * pxm}
						fill="var(--world-px-road-line)"
						stroke="var(--world-px-ridge)"
						stroke-width={1.5 * k}
						{...PX}
					/>
					<text
						x={t.x}
						y={t.z}
						text-anchor="middle"
						dominant-baseline="central"
						font-size={9 * pxm}
						fill="var(--world-px-ridge)">{t.km}</text
					>
				{/each}
			</g>
			<!-- The riders around you: ink, smaller than you, never watt. -->
			<g class="font-display">
				{#each around as mate, i (i)}
					<circle
						data-testid="map-mate"
						cx={mate.x}
						cy={mate.z}
						r={80 * u}
						fill="var(--color-ink)"
						stroke="var(--color-surface)"
						stroke-width={2.5 * k}
						{...PX}
					/>
					<text
						data-testid="map-mate-label"
						x={mate.x + 130 * u}
						y={mate.z + 65 * u}
						font-size={T.village}
						font-weight="600"
						fill="var(--color-ink)"
						stroke="var(--color-surface)"
						stroke-width={T.village * 0.25}
						paint-order="stroke"
						stroke-linejoin="round">{mate.label}</text
					>
				{/each}
			</g>
			<!-- Where you are: in watt, the one thing on the map that glows. -->
			{#if you === 'watt'}
				<circle
					cx={here.x}
					cy={here.z}
					r={180 * u}
					fill="var(--color-watt)"
					opacity="0.7"
					filter="url(#{uid}-glow)"
				/>
				<circle
					data-testid="map-dot"
					cx={here.x}
					cy={here.z}
					r={110 * u}
					fill="var(--color-watt)"
					stroke="var(--world-px-road-line)"
					stroke-width={2.5 * k}
					{...PX}
				/>
			{:else if you === 'ink'}
				<circle
					cx={here.x}
					cy={here.z}
					r={170 * u}
					fill="none"
					stroke="var(--color-surface)"
					stroke-width={6 * k}
					{...PX}
				/>
				<circle
					cx={here.x}
					cy={here.z}
					r={170 * u}
					fill="none"
					stroke="var(--color-ink)"
					stroke-width={3 * k}
					{...PX}
				/>
				<circle
					data-testid="map-dot"
					cx={here.x}
					cy={here.z}
					r={85 * u}
					fill="var(--color-ink)"
					stroke="var(--color-surface)"
					stroke-width={2 * k}
					{...PX}
				/>
			{/if}
			<!-- The map's name, as a game's island map writes it, and a quiet
			     north and scale. -->
			<g
				class="font-display"
				fill="var(--world-px-road-line)"
				stroke="var(--world-px-ridge)"
				stroke-opacity="0.6"
				paint-order="stroke"
				stroke-linejoin="round"
			>
				<text
					x={v.x + 250 * u}
					y={v.z + 640 * u}
					font-size={480 * u}
					font-weight="800"
					letter-spacing={20 * u}
					stroke-width={70 * u}>{MAP.name.toUpperCase()}</text
				>
				<g
					transform="translate({v.x + v.w - 380 * u} {v.z +
						480 * u}) scale({u})"
				>
					<path d="M0,-230L110,90L0,40L-110,90Z" stroke-width="40" />
					<text
						y="280"
						text-anchor="middle"
						font-size="170"
						font-weight="700"
						stroke-width="45">N</text
					>
				</g>
				<!-- The scale bar: `bar` metres of the map, drawn in a mark's metres. -->
				<g
					transform="translate({v.x + 300 * u} {v.z +
						v.h -
						300 * u}) scale({u})"
				>
					<path d="M0,0h{barLength}" stroke-width="80" stroke-linecap="butt" />
					<path
						d="M0,0h{barLength}"
						stroke="var(--world-px-road-line)"
						stroke-opacity="1"
						stroke-width="45"
						stroke-dasharray="{barLength / 4} {barLength / 4}"
						stroke-linecap="butt"
					/>
					{#each [0, 1, 2] as i (i)}
						<text
							x={(i * barLength) / 2}
							y="-110"
							text-anchor="middle"
							font-size="150"
							font-weight="700"
							stroke-width="40">{tick((i * bar) / 2, i === 2)}</text
						>
					{/each}
				</g>
			</g>
		</g>
		<rect
			x={mx}
			y={mz}
			width={mw}
			height={mh}
			fill="none"
			stroke="var(--world-px-ridge)"
			stroke-width={3 * k}
			{...PX}
		/>
	</svg>
</div>
