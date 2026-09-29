<script lang="ts">
	// The ride world with a desk's worth of controls: your watts, the art
	// style, the camera, time, and a GPX of your own. It owns the canvas and
	// hands it to scene.ts; everything three.js happens there.
	import { onMount, untrack } from 'svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import Profile from './Profile.svelte';
	import { buildFailureMessage, parseGpx } from './gpx';
	import { placeScene } from './place-scene';
	import { toRoute, type Route } from './route';
	import { mount, type CameraMode, type Hud, type WorldScene } from './scene';
	import type { Style } from './styles';
	import { syntheticGpx } from './synthetic';
	import { generate, type World } from './world';

	let { styles }: { styles: readonly Style[] } = $props();

	type Built = { route: Route; world: World; ms: number };
	const CAMERAS: { id: CameraMode; label: string }[] = [
		{ id: 'chase', label: 'Chase' },
		{ id: 'heli', label: 'Heli' },
		{ id: 'orbit', label: 'Orbit' },
	];
	const SPEEDS = [1, 4, 16];

	let built = $state.raw<Built | null>(null);
	let building = $state(true);
	let failed = $state(''); // the default route would not build
	let fileError = $state(''); // a rider's GPX would not
	let drawFailed = $state(false); // the 3D view would not start: no WebGL, most often
	let draws = $state(0); // bumped by "Try again" to start the view afresh
	let host = $state<HTMLDivElement>();
	let hud = $state.raw<Hud | null>(null);
	let watts = $state(200);
	let styleId = $state(untrack(() => styles[0]?.id ?? ''));
	let camera = $state<CameraMode>('chase');
	let speedup = $state(1);
	let scene: WorldScene | null = null;
	const profile = createProfileStore();

	const style = $derived(styles.find((s) => s.id === styleId) ?? styles[0]);

	function build(text: string): Built {
		const t0 = performance.now();
		const { name, points } = parseGpx(text);
		const route = toRoute(name, points);
		return { route, world: generate(route), ms: performance.now() - t0 };
	}

	// The generator holds the main thread for a moment: let "Building" paint first.
	const nextPaint = () => new Promise((r) => setTimeout(r, 40));

	async function buildDefault() {
		building = true;
		failed = '';
		await nextPaint();
		try {
			built = build(syntheticGpx());
		} catch (err) {
			console.error('world: the synthetic route did not build', err);
			failed = 'The world did not build.';
		} finally {
			building = false;
		}
	}
	onMount(buildDefault);

	async function pick(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!file) return;
		fileError = '';
		building = true;
		try {
			const text = await file.text(); // the file never leaves this tab
			await nextPaint();
			built = build(text);
		} catch (err) {
			fileError = buildFailureMessage(err);
		} finally {
			building = false;
		}
	}

	$effect(() => {
		const data = built;
		const into = host;
		void draws;
		if (!data || !into) return;
		const placed = untrack(() =>
			placeScene(
				into,
				`A world generated around ${data.route.name}, with you and three riders on it`,
				(canvas) =>
					mount(canvas, {
						route: data.route,
						world: data.world,
						style,
						camera,
						watts,
						ftp: profile.current.ftp,
						speedup,
						onTick: (next) => (hud = next),
					}),
			),
		);
		if (!placed) {
			drawFailed = true;
			return;
		}
		scene = placed.scene;
		return () => {
			placed.remove();
			if (scene === placed.scene) scene = null;
		};
	});

	function redraw() {
		drawFailed = false;
		draws++;
	}

	// One panel for whatever stops the page: what happened, why, and a retry.
	const blocked = $derived(
		failed
			? {
					what: failed,
					why: 'The browser console has the reason. Trying again rebuilds it from the start.',
					retry: buildDefault,
				}
			: drawFailed
				? {
						what: 'The 3D view did not start.',
						why: 'Most often the browser gave this page no WebGL: hardware acceleration is off, or too many 3D tabs are open. The browser console has the exact reason.',
						retry: redraw,
					}
				: null,
	);

	function chooseStyle(next: Style) {
		styleId = next.id;
		scene?.setStyle(next);
	}
	function chooseCamera(next: CameraMode) {
		camera = next;
		scene?.setCamera(next);
	}
	function chooseSpeed(next: number) {
		speedup = next;
		scene?.setSpeedup(next);
	}
	function setWatts(e: Event & { currentTarget: HTMLInputElement }) {
		watts = Number(e.currentTarget.value);
		scene?.setWatts(watts);
	}
</script>

<div class="relative h-full min-h-[560px] overflow-hidden">
	<div bind:this={host} class="absolute inset-0"></div>

	{#if blocked}
		<div class="bg-surface absolute inset-0 grid place-items-center p-6">
			<div class="panel panel-lg max-w-sm text-center" role="alert">
				<p class="text-sm">{blocked.what}</p>
				<p class="text-muted mt-1 text-sm">{blocked.why}</p>
				<button class="btn btn-secondary mt-4" onclick={blocked.retry}
					>Try again</button
				>
			</div>
		</div>
	{:else if building && !built}
		<p
			class="bg-surface text-muted absolute inset-0 m-0 grid place-items-center text-sm"
		>
			Building the world from the route…
		</p>
	{/if}

	{#if built && !drawFailed}
		{@const { route, world } = built}
		<section
			aria-label="Your ride"
			class="border-muted/15 bg-surface/90 absolute top-3 right-3 left-3 grid gap-2 rounded-lg border px-4 py-3 sm:right-auto sm:w-60"
		>
			<p class="m-0 flex items-baseline gap-1">
				<span
					class="font-display text-watt glow-text text-5xl leading-none font-bold tabular-nums"
					>{watts}</span
				>
				<span class="text-muted text-sm">W</span>
			</p>
			{#if hud}
				<dl class="m-0 grid grid-cols-3 gap-1">
					<div>
						<dt class="text-muted text-xs">km/h</dt>
						<dd class="num m-0 text-lg">{hud.kmh.toFixed(1)}</dd>
					</div>
					<div>
						<dt class="text-muted text-xs">road %</dt>
						<dd class="num m-0 text-lg">{hud.grade.toFixed(1)}</dd>
					</div>
					<div>
						<dt class="text-muted text-xs">km</dt>
						<dd class="num m-0 text-lg">{hud.km.toFixed(1)}</dd>
					</div>
				</dl>
				<p class="text-muted m-0 text-xs">
					Trainer gets {hud.trainer.toFixed(1)} % · {Math.round(hud.ele)} m{hud.toTop >
					0
						? ` · top in ${hud.toTop.toFixed(1)} km`
						: ''}
				</p>
			{/if}
			<label class="eyebrow" for="world-watts">Your watts</label>
			<input
				id="world-watts"
				type="range"
				min="0"
				max="600"
				step="5"
				value={watts}
				oninput={setWatts}
			/>
		</section>

		<section
			aria-label="View"
			class="border-muted/15 bg-surface/90 absolute right-3 bottom-32 left-3 grid gap-2 rounded-lg border px-4 py-3 sm:top-3 sm:bottom-auto sm:left-auto sm:max-w-sm sm:justify-items-end"
		>
			<div class="flex flex-wrap gap-1 sm:justify-end">
				{#each styles as s (s.id)}
					<button
						class="btn btn-xs btn-secondary"
						class:bg-surface-raised={styleId === s.id}
						aria-pressed={styleId === s.id}
						title={s.ride
							? 'Legible live watts: fit for a ride'
							: 'Desk view: previews, replays, share cards'}
						onclick={() => chooseStyle(s)}>{s.label}</button
					>
				{/each}
			</div>
			<div class="flex flex-wrap gap-1 sm:justify-end">
				{#each CAMERAS as c (c.id)}
					<button
						class="btn btn-xs btn-secondary"
						class:bg-surface-raised={camera === c.id}
						aria-pressed={camera === c.id}
						onclick={() => chooseCamera(c.id)}>{c.label}</button
					>
				{/each}
				{#each SPEEDS as k (k)}
					<button
						class="btn btn-xs btn-secondary"
						class:bg-surface-raised={speedup === k}
						aria-pressed={speedup === k}
						aria-label="{k} times speed"
						onclick={() => chooseSpeed(k)}>{k}×</button
					>
				{/each}
			</div>
			<label class="btn btn-xs btn-secondary cursor-pointer">
				{building ? 'Building…' : 'Load a GPX'}
				<input
					type="file"
					accept=".gpx,application/gpx+xml"
					class="sr-only"
					disabled={building}
					onchange={pick}
				/>
			</label>
			{#if fileError}
				<p class="text-danger m-0 text-xs" role="alert">{fileError}</p>
			{/if}
			<p class="text-muted m-0 text-xs sm:text-right">
				{world.names.pass} ({Math.round(route.maxEle)} m) under the {world.names
					.peak} · {route.name} · {(route.length / 1000).toFixed(1)} km · {Math.round(
					route.gain,
				)} m up · built in {Math.round(built.ms)} ms · {world.trees.length / 5}
				trees, {world.houses.length / 5} houses
			</p>
			<p class="text-muted m-0 text-xs sm:text-right">
				A GPX you load stays in this tab. Everything beside the road is
				generated.
			</p>
		</section>

		<div
			class="border-muted/15 bg-surface/80 absolute right-3 bottom-3 left-3 h-24 rounded-lg border px-2 py-1.5"
		>
			<Profile {route} riders={hud?.riders ?? []} />
		</div>
	{/if}
</div>
