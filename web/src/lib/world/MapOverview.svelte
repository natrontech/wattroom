<script lang="ts">
	/**
	 * A world from above, as a map draws one (the route lab's Map). On the
	 * designed map (designs.ts) it is the map's own picture, drawn once
	 * (map-render.ts, .claude/skills/render-map): the land in the 3D world's
	 * colours, every road to the picture's edge, the names; over it, live, the
	 * loop you ride and where you are. Any other road is drawn from its world:
	 * the road ridden and the roads that leave it, the water, the bridges and
	 * galleries, the villages and passes by name. North is up.
	 */
	import { at } from '#lib/road/along.ts';
	import type { Route } from '#lib/road/route.ts';
	import { sceneOf } from './designed';
	import type { MapData } from './map-render';
	import MAP_JSON from './wattalp-map.json';
	import mapPicture from './wattalp-map.png';
	import type { World } from './world';

	let { route, world, m }: { route: Route; world: World; m: number } = $props();

	const MAP = MAP_JSON as MapData;

	const line = (r: Route, from = 0, to = r.length) => {
		const out: string[] = [];
		for (let d = from; d <= to; d += 10) {
			const p = at(r, Math.min(d, r.length));
			out.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
		}
		return `M${out.join('L')}`;
	};
	const ring = (pts: readonly (readonly [number, number])[]) =>
		`M${pts.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join('L')}Z`;

	/** The map's picture shows this road: one of its loops, in its frame. */
	const onMap = $derived(
		route.scene !== undefined && MAP.loops.includes(route.scene),
	);
	const you = $derived(at(route, m));

	// The map's picture: its rectangle in the world's frame (x east, z south).
	const mx = MAP.bounds.west;
	const mz = -MAP.bounds.north;
	const mw = MAP.bounds.east - MAP.bounds.west;
	const mh = MAP.bounds.north - MAP.bounds.south;
	const ridden = $derived(onMap ? line(route) : '');
	/** The scale bar: 2 km in four 500 m blocks. */
	const SCALE = [0, 1, 2, 3];

	// The fallback: a road the map does not show, fitted round its own roads.
	const box = $derived.by(() => {
		let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
		for (const r of [route, ...world.sides.map((s) => s.route)])
			for (let i = 0; i < r.x.length; i++) {
				x0 = Math.min(x0, r.x[i]);
				x1 = Math.max(x1, r.x[i]);
				z0 = Math.min(z0, r.z[i]);
				z1 = Math.max(z1, r.z[i]);
			}
		const pad = 0.06 * Math.max(x1 - x0, z1 - z0) + 150;
		return {
			x: x0 - pad,
			z: z0 - pad,
			w: x1 - x0 + 2 * pad,
			h: z1 - z0 + 2 * pad,
		};
	});
	/** A metre of the map in the drawing's own units: strokes and type are sized by it, so they read alike on a 10 km loop and a 30 km one. */
	const u = $derived(Math.max(box.w, box.h) / 1000);
	const still = $derived(world.waters.filter((w) => !w.run));
	const running = $derived(world.waters.filter((w) => w.run));
	const passes = $derived(sceneOf(route.scene)?.names.passes ?? []);
	const villages = $derived(
		world.villageNames.map((v) => ({ name: v.name, ...at(route, v.d) })),
	);
</script>

{#if onMap}
	<svg
		viewBox="{mx} {mz} {mw} {mh}"
		class="h-full w-full"
		role="img"
		aria-label="the map of {MAP.name}, and where you are on it"
		data-testid="map-overview"
	>
		<defs>
			<clipPath id="map-frame">
				<rect x={mx} y={mz} width={mw} height={mh} />
			</clipPath>
		</defs>
		<g clip-path="url(#map-frame)">
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
			<!-- Where you are: the only live thing that glows. -->
			<circle
				cx={you.x}
				cy={you.z}
				r="120"
				fill="var(--color-watt)"
				stroke="var(--world-px-prop-wall)"
				stroke-width="3"
				vector-effect="non-scaling-stroke"
			/>
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
					<path
						d="M0,-210L95,90L0,40L-95,90Z"
						fill="var(--world-px-prop-wall)"
					/>
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
							fill={k % 2
								? 'var(--world-px-ridge)'
								: 'var(--world-px-prop-wall)'}
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
{:else}
	<svg
		viewBox="{box.x} {box.z} {box.w} {box.h}"
		class="h-full w-full"
		style="background: var(--world-px-biome-meadow)"
		role="img"
		aria-label="the map from above, and where you are on it"
		data-testid="map-overview"
	>
		{#each still as w, i (i)}
			<path d={ring(w.outline)} fill="var(--world-px-biome-water)" />
		{/each}
		{#each running as w, i (i)}
			<path
				d={ring(w.outline)}
				fill="var(--world-px-biome-water)"
				opacity="0.9"
			/>
		{/each}
		<!-- The roads you are not on, then yours over them. -->
		{#each world.sides as side, i (i)}
			<path
				d={line(side.route)}
				fill="none"
				stroke="var(--world-px-road-shoulder)"
				stroke-width={5 * u}
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
			{#each side.bridges as [from, to], k (k)}
				<path
					d={line(side.route, from, to)}
					fill="none"
					stroke="var(--world-px-prop-stone)"
					stroke-width={8 * u}
				/>
			{/each}
		{/each}
		<path
			d={line(route)}
			fill="none"
			stroke="var(--world-px-road-asphalt)"
			stroke-width={9 * u}
			stroke-linejoin="round"
		/>
		<path
			d={line(route)}
			fill="none"
			stroke="var(--world-px-road-line)"
			stroke-width={1.6 * u}
			stroke-linejoin="round"
		/>
		{#each world.bridges as [from, to], k (k)}
			<path
				d={line(route, from, to)}
				fill="none"
				stroke="var(--world-px-prop-stone)"
				stroke-width={13 * u}
				stroke-dasharray="{2 * u} {2 * u}"
			/>
		{/each}
		{#each world.galleries as [from, to], k (k)}
			<path
				d={line(route, from, to)}
				fill="none"
				stroke="var(--color-ink)"
				stroke-width={13 * u}
				stroke-dasharray="{4 * u} {4 * u}"
				opacity="0.7"
			/>
		{/each}
		<g
			font-size={17 * u}
			class="font-display"
			fill="var(--color-ink)"
			stroke="var(--color-surface)"
			stroke-width={3.5 * u}
			paint-order="stroke"
		>
			{#each passes as p (p.name)}
				<path
					d="M{p.x - 9 * u},{p.z + 7 * u}L{p.x},{p.z - 9 * u}L{p.x +
						9 * u},{p.z + 7 * u}Z"
					stroke-width={2 * u}
				/>
				<text x={p.x + 14 * u} y={p.z + 6 * u}>{p.name}</text>
			{/each}
			{#each villages as v (v.name)}
				<circle cx={v.x} cy={v.z} r={6 * u} stroke-width={2 * u} />
				<text x={v.x + 12 * u} y={v.z + 6 * u}>{v.name}</text>
			{/each}
		</g>
		<circle
			cx={you.x}
			cy={you.z}
			r={11 * u}
			fill="var(--color-watt)"
			stroke="var(--color-surface)"
			stroke-width={3 * u}
		/>
	</svg>
{/if}
