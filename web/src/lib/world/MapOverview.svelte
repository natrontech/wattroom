<script lang="ts">
	/**
	 * A world from above, as a map draws one (the route lab's Map). A loop of
	 * the designed map (designs.ts) shows the whole map, Wattalp
	 * (WattalpMap.svelte), with its own loop on top. Any other road is drawn
	 * from its world:
	 * the road ridden and the roads that leave it, the water, the bridges and
	 * galleries, the villages and passes by name. North is up.
	 */
	import { at } from '#lib/road/along.ts';
	import type { Route } from '#lib/road/route.ts';
	import { sceneOf } from './designed';
	import { WATTALP } from './wattalp';
	import WattalpMap from './WattalpMap.svelte';
	import type { World } from './world';

	let { route, world, m }: { route: Route; world: World; m: number } = $props();

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
		route.scene !== undefined && WATTALP.loops.includes(route.scene),
	);
	const you = $derived(at(route, m));

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
	<WattalpMap line={route} {m} />
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
