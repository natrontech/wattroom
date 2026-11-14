<script lang="ts">
	/**
	 * The map of one of WattRoom's designed lands (designs.ts LANDS: Wattalp,
	 * the Valley's Rahmental), as a game draws its island (Zwift's Watopia):
	 * its own picture, drawn once (map-render.ts, .claude/skills/render-map),
	 * the land in flat areas of the 3D world's colours; over it every road a
	 * thin dark line, the roundabouts small rings; and live, the loop you ride
	 * as a white line on top, bright ahead of you and faint behind, its start
	 * and finish, the places it rides through by name, and where you are.
	 * Every loop on a land shows the whole land. North is up.
	 */
	import { at } from '#lib/road/along.ts';
	import type { Route } from '#lib/road/route.ts';
	import type { LandMapOf } from './land-map';

	let {
		map,
		line,
		m,
		reverse = false,
		mates = [],
		you = 'watt',
		toGo,
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
		/** Your dot: watt where nothing else marks you, ink where the Skyline beside it does (the ride's G2). */
		you?: 'watt' | 'ink';
		/** Kilometres to the finish, written by its flag. */
		toGo?: number;
	} = $props();
	const uid = $props.id();
	const MAP = $derived(map.data);
	/** Every mark drawn in the map's metres, this many times Wattalp's: a smaller land, drawn as large, reads alike. */
	const s = $derived(MAP.scale ?? 1);
	/** The scale bar's kilometres: two on Wattalp. */
	const bar = $derived(2 * s);

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
	const T = $derived(MAP.type);
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
</script>

<div class="h-full w-full" bind:clientWidth={cw} bind:clientHeight={ch}>
	<svg
		viewBox="{mx} {mz} {mw} {mh}"
		class="h-full w-full"
		role="img"
		aria-label="the map of {MAP.name}, and where you are on it"
		data-testid="map-overview"
	>
		<defs>
			<clipPath id="{uid}-frame">
				<rect x={mx} y={mz} width={mw} height={mh} />
			</clipPath>
			<filter id="{uid}-glow" x="-100%" y="-100%" width="300%" height="300%">
				<feGaussianBlur stdDeviation={70 * s} />
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
					r={45 * s}
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
							d="M{l.x - 70 * s},{l.z + 50 * s}L{l.x},{l.z - 70 * s}L{l.x +
								70 * s},{l.z + 50 * s}Z"
							fill="var(--world-px-road-line)"
							stroke="var(--world-px-ridge)"
							stroke-width={20 * s}
						/>
					{:else}
						<circle
							cx={l.x}
							cy={l.z}
							r={45 * s}
							fill="var(--world-px-road-line)"
							stroke="var(--world-px-ridge)"
							stroke-width={20 * s}
						/>
					{/if}
					<text
						x={l.tx}
						y={l.tz}
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
			<g transform="translate({start.x} {start.z}) scale({s})">
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
						font-size={(T.pass / s) * 1.15}
						font-weight="700"
						fill="var(--world-px-road-line)"
						stroke="var(--world-px-ridge)"
						stroke-opacity="0.8"
						stroke-width={(T.pass / s) * 0.25}
						paint-order="stroke"
						stroke-linejoin="round">{toGo.toFixed(1)} km to go</text
					>
				{/if}
			</g>
			<!-- The riders around you: ink, smaller than you, never watt. -->
			<g class="font-display">
				{#each around as mate, i (i)}
					<circle
						data-testid="map-mate"
						cx={mate.x}
						cy={mate.z}
						r={80 * s}
						fill="var(--color-ink)"
						stroke="var(--color-surface)"
						stroke-width={2.5 * k}
						{...PX}
					/>
					<text
						data-testid="map-mate-label"
						x={mate.x + 130 * s}
						y={mate.z + 65 * s}
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
					r={180 * s}
					fill="var(--color-watt)"
					opacity="0.7"
					filter="url(#{uid}-glow)"
				/>
				<circle
					data-testid="map-dot"
					cx={here.x}
					cy={here.z}
					r={110 * s}
					fill="var(--color-watt)"
					stroke="var(--world-px-road-line)"
					stroke-width={2.5 * k}
					{...PX}
				/>
			{:else}
				<circle
					cx={here.x}
					cy={here.z}
					r={170 * s}
					fill="none"
					stroke="var(--color-surface)"
					stroke-width={6 * k}
					{...PX}
				/>
				<circle
					cx={here.x}
					cy={here.z}
					r={170 * s}
					fill="none"
					stroke="var(--color-ink)"
					stroke-width={3 * k}
					{...PX}
				/>
				<circle
					data-testid="map-dot"
					cx={here.x}
					cy={here.z}
					r={85 * s}
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
					x={mx + 250 * s}
					y={mz + 640 * s}
					font-size={480 * s}
					font-weight="800"
					letter-spacing={20 * s}
					stroke-width={70 * s}>{MAP.name.toUpperCase()}</text
				>
				<g transform="translate({mx + mw - 380 * s} {mz + 480 * s}) scale({s})">
					<path d="M0,-230L110,90L0,40L-110,90Z" stroke-width="40" />
					<text
						y="280"
						text-anchor="middle"
						font-size="170"
						font-weight="700"
						stroke-width="45">N</text
					>
				</g>
				<!-- The scale bar's metres are the map's: drawn at its scale, it is 2 · scale km long. -->
				<g transform="translate({mx + 300 * s} {mz + mh - 300 * s}) scale({s})">
					<path d="M0,0h2000" stroke-width="80" stroke-linecap="butt" />
					<path
						d="M0,0h2000"
						stroke="var(--world-px-road-line)"
						stroke-opacity="1"
						stroke-width="45"
						stroke-dasharray="500 500"
						stroke-linecap="butt"
					/>
					{#each [0, 1, 2] as tick (tick)}
						<text
							x={tick * 1000}
							y="-110"
							text-anchor="middle"
							font-size="150"
							font-weight="700"
							stroke-width="40"
							>{tick === 2 ? `${bar} km` : (tick * bar) / 2}</text
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
