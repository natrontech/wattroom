<script lang="ts">
	/**
	 * The map of Wattalp, WattRoom's designed land (designs.ts): its own
	 * picture, drawn once (map-render.ts, .claude/skills/render-map), the land
	 * in the 3D world's colours, every road to the picture's edge, the names;
	 * over it, live, the loop you ride and where you are. Every loop on the map
	 * shows the whole map, its own loop on top. North is up.
	 */
	import { at } from '#lib/road/along.ts';
	import type { Route } from '#lib/road/route.ts';
	import mapPicture from './wattalp-map.png';
	import { WATTALP as MAP } from './wattalp';

	let {
		line,
		m,
		mates = [],
		you = 'watt',
	}: {
		/** The loop ridden, in the map's frame: a route this map's picture shows. */
		line: Route;
		/** Where you are: metres along `line`. */
		m: number;
		/** The riders around you: metres along `line`, and names. */
		mates?: { m: number; label: string }[];
		/** Your dot: watt where nothing else marks you, ink where the Skyline beside it does (the ride's G2). */
		you?: 'watt' | 'ink';
	} = $props();
	const uid = $props.id();

	const path = (r: Route, from = 0, to = r.length) => {
		const out: string[] = [];
		for (let d = from; d <= to; d += 10) {
			const p = at(r, Math.min(d, r.length));
			out.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
		}
		return `M${out.join('L')}`;
	};

	const here = $derived(at(line, m));
	const around = $derived(
		mates.map((mate) => ({ label: mate.label, ...at(line, mate.m) })),
	);

	// The map's picture: its rectangle in the world's frame (x east, z south).
	const mx = MAP.bounds.west;
	const mz = -MAP.bounds.north;
	const mw = MAP.bounds.east - MAP.bounds.west;
	const mh = MAP.bounds.north - MAP.bounds.south;
	const ridden = $derived(path(line));
	/** The scale bar: 2 km in four 500 m blocks. */
	const SCALE = [0, 1, 2, 3];
</script>

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
	</defs>
	<g clip-path="url(#{uid}-frame)">
		<image
			href={mapPicture}
			x={mx}
			y={mz}
			width={mw}
			height={mh}
			preserveAspectRatio="none"
		/>
		<!-- Every road, as a game's map draws it: a dark casing under a pale
		     fill, the loops broader than the lanes off them; a bridge's
		     parapets stand out either side. Strokes in screen pixels. -->
		<g
			fill="none"
			stroke-linejoin="round"
			stroke-linecap="round"
			vector-effect="non-scaling-stroke"
		>
			<path
				d={MAP.roads.bridges}
				stroke="var(--world-px-ridge)"
				stroke-width="15"
				stroke-linecap="butt"
				vector-effect="non-scaling-stroke"
			/>
			<path
				d={MAP.roads.bridges}
				stroke="var(--world-px-prop-wall)"
				stroke-width="12"
				stroke-linecap="butt"
				vector-effect="non-scaling-stroke"
			/>
			<path
				d={MAP.roads.spurs}
				stroke="var(--world-px-ridge)"
				stroke-width="5.5"
				vector-effect="non-scaling-stroke"
			/>
			<path
				d={MAP.roads.loops}
				stroke="var(--world-px-ridge)"
				stroke-width="8"
				vector-effect="non-scaling-stroke"
			/>
			<path
				d={MAP.roads.spurs}
				stroke="var(--world-px-road-shoulder)"
				stroke-width="3"
				vector-effect="non-scaling-stroke"
			/>
			<path
				d={MAP.roads.loops}
				stroke="var(--world-px-road-line)"
				stroke-width="5"
				vector-effect="non-scaling-stroke"
			/>
			<!-- Under a gallery's roof: the road dashed dark. -->
			<path
				d={MAP.roads.galleries}
				stroke="var(--world-px-ridge)"
				stroke-width="5"
				stroke-dasharray="3 3"
				stroke-linecap="butt"
				vector-effect="non-scaling-stroke"
			/>
			<!-- The loop you ride, over them all. -->
			<path
				d={ridden}
				stroke="var(--world-px-ridge)"
				stroke-width="10"
				vector-effect="non-scaling-stroke"
			/>
			<path
				d={ridden}
				stroke="var(--world-dio-sky-sunward)"
				stroke-width="6"
				vector-effect="non-scaling-stroke"
			/>
		</g>
		<!-- Names, each with a dark halo so it reads on snow and meadow alike. -->
		<g
			class="font-display"
			fill="var(--world-px-prop-wall)"
			stroke="var(--world-px-ridge)"
			paint-order="stroke"
			stroke-linejoin="round"
		>
			{#each MAP.labels as l (l.kind + l.name)}
				{#if l.kind === 'water' || l.kind === 'river'}
					<text
						x={l.tx}
						y={l.tz}
						text-anchor="middle"
						dominant-baseline="middle"
						font-size="210"
						font-style="italic"
						letter-spacing="40"
						fill="var(--world-px-sky-light)"
						stroke="var(--world-px-biome-water)"
						stroke-width="40"
						opacity="0.9"
						transform={l.angle ? `rotate(${l.angle} ${l.tx} ${l.tz})` : ''}
						>{l.name}</text
					>
				{:else if l.kind === 'pass'}
					<path
						d="M{l.x - 70},{l.z + 55}L{l.x},{l.z - 70}L{l.x + 70},{l.z + 55}Z"
						fill="var(--world-px-ridge)"
						stroke="var(--world-px-biome-snow)"
						stroke-width="22"
					/>
					<text
						x={l.tx}
						y={l.tz}
						text-anchor={l.anchor}
						font-size="160"
						font-weight="700"
						stroke-width="40"
						>{l.name}<tspan
							x={l.tx}
							dy="150"
							font-size="120"
							font-weight="500"
							fill="var(--world-px-sky-light)">{l.ele} m</tspan
						></text
					>
				{:else}
					<circle
						cx={l.x}
						cy={l.z}
						r="48"
						fill="var(--world-px-prop-wall)"
						stroke="var(--world-px-ridge)"
						stroke-width="22"
					/>
					<text
						x={l.tx}
						y={l.tz}
						text-anchor={l.anchor}
						font-size="150"
						font-weight="600"
						stroke-width="38">{l.name}</text
					>
				{/if}
			{/each}
		</g>
		<!-- The riders around you: ink, smaller than you, never watt. -->
		<g class="font-display">
			{#each around as mate, i (i)}
				<circle
					data-testid="map-mate"
					cx={mate.x}
					cy={mate.z}
					r="80"
					fill="var(--color-ink)"
					stroke="var(--color-surface)"
					stroke-width="3"
					vector-effect="non-scaling-stroke"
				/>
				<text
					data-testid="map-mate-label"
					x={mate.x + 130}
					y={mate.z + 50}
					font-size="150"
					font-weight="600"
					fill="var(--color-ink)"
					stroke="var(--color-surface)"
					stroke-width="40"
					paint-order="stroke"
					stroke-linejoin="round">{mate.label}</text
				>
			{/each}
		</g>
		<!-- Where you are. -->
		{#if you === 'watt'}
			<circle
				data-testid="map-dot"
				cx={here.x}
				cy={here.z}
				r="120"
				fill="var(--color-watt)"
				stroke="var(--world-px-prop-wall)"
				stroke-width="3"
				vector-effect="non-scaling-stroke"
			/>
		{:else}
			<circle
				cx={here.x}
				cy={here.z}
				r="170"
				fill="none"
				stroke="var(--color-ink)"
				stroke-width="3"
				vector-effect="non-scaling-stroke"
			/>
			<circle
				data-testid="map-dot"
				cx={here.x}
				cy={here.z}
				r="90"
				fill="var(--color-ink)"
				stroke="var(--color-surface)"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
			/>
		{/if}
		<!-- The map's own furniture: its name, north, and a scale. -->
		<g class="font-display">
			<rect
				x={mx + 160}
				y={mz + 160}
				width="2400"
				height="860"
				rx="70"
				fill="var(--world-px-ridge)"
				fill-opacity="0.82"
				stroke="var(--world-px-prop-wall)"
				stroke-opacity="0.5"
				stroke-width="14"
			/>
			<text
				x={mx + 330}
				y={mz + 600}
				font-size="400"
				font-weight="800"
				letter-spacing="50"
				fill="var(--world-px-prop-wall)">{MAP.name.toUpperCase()}</text
			>
			<path
				d="M{mx + 340},{mz + 780}h420"
				stroke="var(--world-px-ridge)"
				stroke-width="70"
				stroke-linecap="round"
			/>
			<path
				d="M{mx + 340},{mz + 780}h420"
				stroke="var(--world-dio-sky-sunward)"
				stroke-width="38"
				stroke-linecap="round"
			/>
			<text
				x={mx + 830}
				y={mz + 820}
				font-size="120"
				fill="var(--world-px-sky-light)">your loop</text
			>
			<path
				d="M{mx + 1420},{mz + 780}h320"
				stroke="var(--world-px-road-line)"
				stroke-width="38"
				stroke-linecap="round"
			/>
			<text
				x={mx + 1800}
				y={mz + 820}
				font-size="120"
				fill="var(--world-px-sky-light)">roads</text
			>
			<g transform="translate({mx + mw - 420} {mz + 520})">
				<circle
					r="290"
					fill="var(--world-px-ridge)"
					fill-opacity="0.82"
					stroke="var(--world-px-prop-wall)"
					stroke-opacity="0.5"
					stroke-width="14"
				/>
				<path d="M0,-210L95,90L0,40L-95,90Z" fill="var(--world-px-prop-wall)" />
				<path d="M0,-210L0,40L-95,90Z" fill="var(--world-px-sky-haze)" />
				<text
					y="225"
					text-anchor="middle"
					font-size="130"
					font-weight="700"
					fill="var(--world-px-prop-wall)">N</text
				>
			</g>
			<g transform="translate({mx + 260} {mz + mh - 260})">
				<rect
					x="-110"
					y="-330"
					width="2400"
					height="430"
					rx="60"
					fill="var(--world-px-ridge)"
					fill-opacity="0.82"
				/>
				{#each SCALE as k (k)}
					<rect
						x={k * 500}
						y="-70"
						width="500"
						height="70"
						fill={k % 2 ? 'var(--world-px-ridge)' : 'var(--world-px-prop-wall)'}
						stroke="var(--world-px-prop-wall)"
						stroke-width="10"
					/>
				{/each}
				{#each [0, 1, 2] as km (km)}
					<text
						x={km * 1000}
						y="-130"
						text-anchor="middle"
						font-size="120"
						fill="var(--world-px-prop-wall)">{km === 2 ? '2 km' : km}</text
					>
				{/each}
			</g>
		</g>
	</g>
</svg>
