<script lang="ts">
	// The 2.5D horizon: the route's elevation as one line, riders as dots on
	// it — yours in the watt colour. Same data as the 3D world.
	import type { Route } from './route';
	import type { Hud } from './scene';

	let { route, riders }: { route: Route; riders: Hud['riders'] } = $props();

	const W = 1000;
	const H = 140;
	const PAD = 8;
	const POINTS = 500;
	const x = (d: number) => (d / route.length) * W;
	const y = (e: number) =>
		PAD +
		(1 - (e - route.minEle) / Math.max(1, route.maxEle - route.minEle)) *
			(H - 2 * PAD);
	const line = $derived.by(() => {
		const every = Math.max(1, Math.floor(route.ele.length / POINTS));
		let path = '';
		for (let i = 0; i < route.ele.length; i += every)
			path += `${i ? 'L' : 'M'}${x(i * route.step).toFixed(1)},${y(route.ele[i]).toFixed(1)}`;
		return path;
	});
	const area = $derived(`${line}L${W},${H}L0,${H}Z`);
	const dots = $derived(
		riders.map((r) => {
			const d = Math.min(Math.max(r.d, 0), route.length);
			const i = Math.min(route.ele.length - 1, Math.round(d / route.step));
			return {
				...r,
				left: (x(d) / W) * 100,
				top: (y(route.ele[i]) / H) * 100,
			};
		}),
	);
</script>

<div class="relative h-full w-full">
	<svg
		viewBox="0 0 {W} {H}"
		width="100%"
		height="100%"
		preserveAspectRatio="none"
		role="img"
		aria-label="Elevation profile of {route.name}"
		class="block"
	>
		<path d={area} class="fill-neon/15" />
		<path
			d={line}
			fill="none"
			class="stroke-neon"
			stroke-width="2"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
	<!-- Dots are HTML over the stretched SVG, so they stay round. -->
	{#each dots.filter((d) => !d.you) as d (d.id)}
		<span
			class="bg-muted absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
			style="left: {d.left}%; top: {d.top}%"
			title={d.name}
		></span>
	{/each}
	{#each dots.filter((d) => d.you) as d (d.id)}
		<span
			class="bg-watt absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
			style="left: {d.left}%; top: {d.top}%"
			title={d.name}
		></span>
	{/each}
</div>
