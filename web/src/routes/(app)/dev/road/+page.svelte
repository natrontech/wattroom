<script lang="ts">
	/**
	 * The road pipeline on a synthetic fixture, or a file you load (#3023):
	 * what $lib/road makes of a route — the line, the heights and the turns
	 * it keeps, and what it would send. A loaded file never leaves the tab.
	 */
	import { FIXTURES, toGpx } from '$lib/road/fixtures';
	import { parseRoute, type RouteSource } from '$lib/road/parse';
	import { packRoad, roadHash, roadStep } from '$lib/road/road';
	import { toRoute, type Route } from '$lib/road/route';

	const W = 600;
	const H = 180;

	let active = $state(Object.keys(FIXTURES)[0]);
	let built = $state.raw<{ route: Route; src: RouteSource } | null>(null);
	let hash = $state('');
	let error = $state('');

	async function ride(text: string) {
		error = '';
		hash = '';
		try {
			const { points, src } = parseRoute(text);
			built = { route: toRoute(points), src };
			hash = await roadHash(built.route.road);
		} catch (err) {
			built = null;
			error = err instanceof Error ? err.message : String(err);
		}
	}

	function pickFixture(name: string) {
		active = name;
		void ride(toGpx(FIXTURES[name]()));
	}

	async function pickFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		active = '';
		await ride(await file.text());
	}

	pickFixture(Object.keys(FIXTURES)[0]);

	/** The line from above, north up, fitted to the box with its aspect kept. */
	const plan = $derived.by(() => {
		if (!built) return '';
		const { x, z } = built.route;
		const [x0, x1] = [Math.min(...x), Math.max(...x)];
		const [z0, z1] = [Math.min(...z), Math.max(...z)];
		const k = Math.min(
			(W - 20) / (x1 - x0 || 1),
			(H * 2 - 20) / (z1 - z0 || 1),
		);
		return Array.from(
			x,
			(xi, i) =>
				`${i ? 'L' : 'M'}${(10 + (xi - x0) * k).toFixed(1)} ${(10 + (z[i] - z0) * k).toFixed(1)}`,
		).join(' ');
	});

	/** Heights by distance, as the road keeps them every ~20 m. */
	const profile = $derived.by(() => {
		if (!built) return '';
		const { heights } = built.route.road;
		const [lo, hi] = [Math.min(...heights), Math.max(...heights)];
		return heights
			.map(
				(h, i) =>
					`${i ? 'L' : 'M'}${((i / (heights.length - 1)) * W).toFixed(1)} ${(H - 10 - ((h - lo) / (hi - lo || 1)) * (H - 20)).toFixed(1)}`,
			)
			.join(' ');
	});
</script>

<main class="mx-auto max-w-4xl px-6 py-10">
	<h1 class="page-title">Road pipeline</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		What $lib/road makes of a route: spikes dropped, the line smoothed and
		resampled every 10 m, heights through a 200 m median and a 120 m mean, the
		grade held to −15 … +20 %, and the road kept every 20 m as heights and
		turns. The fixtures are made up; a file you load stays in this tab.
	</p>

	<div class="mt-6 flex flex-wrap items-center gap-1">
		{#each Object.keys(FIXTURES) as name (name)}
			<button
				onclick={() => pickFixture(name)}
				class="rounded px-3 py-1.5 text-xs {active === name
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">{name}</button
			>
		{/each}
		<label class="btn btn-xs btn-secondary ml-2">
			Load a GPX or TCX
			<input
				type="file"
				accept=".gpx,.tcx"
				class="sr-only"
				onchange={pickFile}
			/>
		</label>
	</div>

	{#if error}
		<p class="text-danger mt-4 text-sm" role="alert">{error}</p>
	{:else if built}
		{@const { route, src } = built}
		<dl class="mt-6 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
			<dt class="text-muted">Name</dt>
			<dd>{route.name}</dd>
			<dt class="text-muted">Source</dt>
			<dd>{src}</dd>
			<dt class="text-muted">Samples</dt>
			<dd>{route.x.length} every {route.step.toFixed(2)} m</dd>
			<dt class="text-muted">Kept</dt>
			<dd>
				{route.road.heights.length} every {roadStep(route.road).toFixed(2)} m,
				{packRoad(route.road).byteLength} bytes
			</dd>
			<dt class="text-muted">Loop</dt>
			<dd>{route.loop ? 'yes' : 'no'}</dd>
			<dt class="text-muted">Turned</dt>
			<dd>
				{route.road.turns.reduce((a, t) => a + Math.abs(t), 0)}° in all
			</dd>
			<dt class="text-muted">Hash</dt>
			<dd class="col-span-3 font-mono text-xs break-all">{hash || '…'}</dd>
		</dl>

		<section class="panel mt-6">
			<h2 class="text-muted text-xs tracking-wide uppercase">From above</h2>
			<svg
				viewBox="0 0 {W} {H * 2}"
				width="100%"
				class="text-ink mt-2"
				role="img"
				aria-label="The road from above, north up"
			>
				<path d={plan} fill="none" stroke="currentColor" stroke-width="1.5" />
			</svg>
		</section>

		<section class="panel mt-4">
			<h2 class="text-muted text-xs tracking-wide uppercase">
				Heights, {Math.round(route.minEle)}–{Math.round(route.maxEle)} m
			</h2>
			<svg
				viewBox="0 0 {W} {H}"
				width="100%"
				class="text-ink mt-2"
				role="img"
				aria-label="The road's heights by distance"
			>
				<path
					d={profile}
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
				/>
			</svg>
		</section>
	{/if}
</main>
