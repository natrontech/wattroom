<script lang="ts">
	// The route lab, a dev machine's only (dev-only.ts): pick a GPX, TCX or FIT
	// file and ride or fly the road the world builds from it, to see where it
	// goes wrong. The file is read in this tab and goes nowhere: no upload, no
	// account, nothing stored. A note copied from here names a place by its
	// kilometre on the route, never by a coordinate, so it can be pasted into
	// an issue or to an AI (AGENTS.md: route geometry stays out of both).
	import { page } from '$app/state';
	import { parseRoute } from '#lib/road/parse.ts';
	import { toRoute, type Route } from '#lib/road/route.ts';
	import { crossingsOf, type Crossing } from '#lib/world/crossings.ts';
	import type { CameraMode } from '#lib/world/scene.ts';

	const params = page.url.searchParams;
	const CAMERAS: CameraMode[] = ['chase', 'heli', 'side', 'steady', 'orbit'];
	const SPEEDS = [36, 100, 300, 1000]; // km/h

	let route = $state.raw<Route | null>(null);
	let crossings = $state.raw<Crossing[]>([]);
	let source = $state('');
	let error = $state('');
	let share = $state(params.get('share') !== '0');
	let camera = $state<CameraMode>(
		CAMERAS.includes(params.get('camera') as CameraMode)
			? (params.get('camera') as CameraMode)
			: 'chase',
	);
	let kmh = $state(100);
	let playing = $state(false);
	let m = $state(0);
	let note = $state('');
	let copied = $state(false);
	let points: ReturnType<typeof parseRoute>['points'] | null = null;
	let sought = 0;
	let scene: { dispose(): void; setCamera(mode: CameraMode): void } | undefined;

	async function build() {
		if (!points) return;
		try {
			const { routeOfRoad } = await import('#lib/world/road-route.ts');
			// As a ride builds it (RideWorld.svelte): the road the file compiles to, walked.
			const next = routeOfRoad(toRoute(points).road, share);
			route = next;
			crossings = crossingsOf(next);
			m = Math.min(m, next.length - 1);
			error = '';
		} catch (err) {
			route = null;
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function pick(file: File | undefined) {
		if (!file) return;
		try {
			const text = /\.fit$/i.test(file.name)
				? new Uint8Array(await file.arrayBuffer())
				: await file.text();
			points = parseRoute(text).points;
			source = 'your file';
			m = 0;
			await build();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function shape(name: string) {
		const [{ syntheticPoints }, { eight }] = await Promise.all([
			import('#lib/world/synthetic.ts'),
			import('#lib/world/eight.ts'),
		]);
		points =
			name === 'eight'
				? syntheticPoints(eight(0))
				: name === 'bridge'
					? syntheticPoints(eight(8))
					: syntheticPoints();
		source = name;
		m = 0;
		await build();
	}
	if (params.get('shape')) void shape(params.get('shape')!);

	function seek(to: number) {
		if (!route) return;
		m = Math.max(0, Math.min(route.length - 1, to));
		sought = performance.now();
	}

	function world(node: HTMLCanvasElement, r: Route) {
		let gone = false;
		void Promise.all([
			import('#lib/world/scene.ts'),
			import('#lib/world/world.ts'),
			import('#lib/world/look.ts'),
			import('#lib/world/mode.ts'),
		]).then(([{ mount }, { generate }, look, { worldDiorama }]) => {
			if (gone) return;
			const paint = look.worldPaint(node.parentElement ?? document.body);
			scene = mount(node, {
				route: r,
				world: generate(r),
				style: worldDiorama()
					? look.dioramaLook(paint, { night: false, weather: 'clear' })
					: look.rideLook(paint),
				ftp: 250,
				camera,
				// Just sought, the world keeps drawing for a moment: a standing world draws once a second.
				metre: () => ({
					m,
					mps: playing ? kmh / 3.6 : performance.now() - sought < 1500 ? 1 : 0,
				}),
				onFail: (why) => (error = `The world stopped: ${why}`),
			});
		});
		return () => {
			gone = true;
			scene?.dispose();
			scene = undefined;
		};
	}

	$effect(() => {
		if (!playing || !route) return;
		const length = route.length;
		let last = performance.now();
		let raf = requestAnimationFrame(function tick(now) {
			m += ((now - last) / 1000) * (kmh / 3.6);
			last = now;
			if (m >= length - 1) {
				m = length - 1;
				playing = false;
				return;
			}
			raf = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(raf);
	});

	function setCamera(next: CameraMode) {
		camera = next;
		scene?.setCamera(next);
		sought = performance.now();
	}

	// The plan and the profile, drawn from the route's own samples.
	const box = $derived.by(() => {
		if (!route) return null;
		let x0 = Infinity;
		let x1 = -Infinity;
		let z0 = Infinity;
		let z1 = -Infinity;
		for (let i = 0; i < route.x.length; i++) {
			x0 = Math.min(x0, route.x[i]);
			x1 = Math.max(x1, route.x[i]);
			z0 = Math.min(z0, route.z[i]);
			z1 = Math.max(z1, route.z[i]);
		}
		const pad = Math.max(x1 - x0, z1 - z0) * 0.04 + 10;
		return {
			x: x0 - pad,
			z: z0 - pad,
			w: x1 - x0 + 2 * pad,
			h: z1 - z0 + 2 * pad,
		};
	});
	const plan = $derived(
		route
			? Array.from(
					route.x,
					(x, i) => `${x.toFixed(1)},${route!.z[i].toFixed(1)}`,
				).join(' ')
			: '',
	);
	/** The stretches drawn on an earlier pass (shared-road.ts), as index runs. */
	const sharedRuns = $derived.by(() => {
		const runs: string[] = [];
		const s = route?.shared;
		if (!route || !s) return runs;
		let from = -1;
		for (let i = 0; i <= s.length; i++) {
			const on = i < s.length && s[i] > 0;
			if (on && from < 0) from = i;
			if (!on && from >= 0) {
				let d = '';
				for (let k = from; k < i; k++)
					d += `${route.x[k].toFixed(1)},${route.z[k].toFixed(1)} `;
				runs.push(d);
				from = -1;
			}
		}
		return runs;
	});
	const profile = $derived.by(() => {
		if (!route) return '';
		const span = Math.max(1, route.maxEle - route.minEle);
		const n = route.ele.length;
		const every = Math.max(1, Math.floor(n / 600));
		let d = '';
		for (let i = 0; i < n; i += every)
			d += `${((i / (n - 1)) * 1000).toFixed(1)},${(58 - ((route.ele[i] - route.minEle) / span) * 54).toFixed(1)} `;
		return d;
	});
	const here = $derived.by(() => {
		if (!route) return null;
		const at = Math.min(m / route.step, route.x.length - 1);
		const i = Math.min(Math.floor(at), route.x.length - 2);
		const f = at - i;
		return {
			x: route.x[i] + (route.x[i + 1] - route.x[i]) * f,
			z: route.z[i] + (route.z[i + 1] - route.z[i]) * f,
			ele: route.ele[i] + (route.ele[i + 1] - route.ele[i]) * f,
			grade: route.grade[i],
			shared: route.shared?.[i] ?? 0,
		};
	});
	const km = (metres: number) => (metres / 1000).toFixed(2);
	/** The crossing you stand within 90 m of, on either pass. */
	const near = $derived(
		crossings.findIndex(
			(c) => Math.abs(c.a - m) < 90 || Math.abs(c.b - m) < 90,
		),
	);

	function onPlan(event: MouseEvent) {
		if (!route || !box) return;
		const svg = event.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const scale = Math.max(box.w / rect.width, box.h / rect.height);
		const x =
			box.x + box.w / 2 + (event.clientX - rect.left - rect.width / 2) * scale;
		const z =
			box.z + box.h / 2 + (event.clientY - rect.top - rect.height / 2) * scale;
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i < route.x.length; i++) {
			const d = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
			if (d < bestD) ((bestD = d), (best = i));
		}
		seek(best * route.step);
	}

	/** What to paste: the place by its kilometre and what was seen there, no coordinate. */
	const report = $derived.by(() => {
		if (!route || !here) return '';
		const c = near >= 0 ? crossings[near] : null;
		return [
			`Route ride ${km(route.length)} km, +${Math.round(route.gain)} m (${source})`,
			`at ${km(m)} km, ${here.grade.toFixed(1)} %, camera ${camera}${share ? '' : ', shared roads off'}`,
			c
				? `crossing ${near + 1} of ${crossings.length}: passes at ${km(c.a)} km and ${km(c.b)} km, ${c.rise >= 0 ? '+' : ''}${c.rise.toFixed(1)} m, ${Math.round(c.angle)}°`
				: here.shared > 0
					? 'on a stretch drawn on an earlier pass'
					: '',
			note.trim(),
		]
			.filter(Boolean)
			.join('\n');
	});
	async function copy() {
		await navigator.clipboard.writeText(report);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	function onKey(event: KeyboardEvent) {
		if (event.target instanceof HTMLTextAreaElement || !route) return;
		const step = event.shiftKey ? 500 : 50;
		if (event.key === ' ') playing = !playing;
		else if (event.key === 'ArrowRight') seek(m + step);
		else if (event.key === 'ArrowLeft') seek(m - step);
		else if (event.key === 'c')
			setCamera(CAMERAS[(CAMERAS.indexOf(camera) + 1) % CAMERAS.length]);
		else if (event.key === 'n' && crossings.length)
			seek((crossings.find((c) => c.b - 50 > m + 1) ?? crossings[0]).b - 50);
		else return;
		event.preventDefault();
	}

	Object.assign(window, {
		routeLab: {
			seek,
			setCamera,
			crossings: () => crossings,
			length: () => route?.length ?? 0,
		},
	});
</script>

<svelte:window onkeydown={onKey} />

<div
	class="cave bg-surface text-ink flex h-screen"
	role="presentation"
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => {
		e.preventDefault();
		void pick(e.dataTransfer?.files[0]);
	}}
>
	<main class="relative min-w-0 flex-1 bg-black">
		{#if route}
			{#key route}
				<canvas
					class="absolute inset-0 h-full w-full"
					{@attach (node) => world(node, route!)}
				></canvas>
			{/key}
		{:else}
			<p
				class="text-muted absolute inset-0 grid place-items-center p-8 text-center"
			>
				Pick or drop a GPX, TCX or FIT file. It is read in this tab and goes
				nowhere.
			</p>
		{/if}
	</main>

	<aside
		class="border-edge flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l p-4 text-sm"
	>
		<h1 class="font-display text-lg">Route lab</h1>
		<p class="text-muted">
			Dev machines only. Space plays, ← → move 50 m (Shift 500 m), C the camera,
			N the next crossing.
		</p>
		<input
			type="file"
			accept=".gpx,.tcx,.fit"
			class="input"
			onchange={(e) => void pick(e.currentTarget.files?.[0])}
		/>
		<div class="flex flex-wrap gap-2">
			<span class="eyebrow self-center">made up</span>
			{#each [['loop', 'Pass loop'], ['eight', 'Eight, level'], ['bridge', 'Eight, 8 m over']] as [id, label] (id)}
				<button class="btn btn-sm" onclick={() => void shape(id)}
					>{label}</button
				>
			{/each}
		</div>
		{#if error}<p class="text-danger" role="alert">{error}</p>{/if}

		{#if route && box && here}
			<p class="font-display" data-testid="lab-readout">
				{km(m)} / {km(route.length)} km · {Math.round(here.ele)} m · {here.grade.toFixed(
					1,
				)} %
			</p>
			<input
				type="range"
				min="0"
				max={route.length - 1}
				step="1"
				value={m}
				oninput={(e) => seek(Number(e.currentTarget.value))}
				aria-label="Place on the route"
			/>
			<div class="flex flex-wrap items-center gap-2">
				<button
					class="btn btn-sm btn-primary"
					onclick={() => (playing = !playing)}
				>
					{playing ? 'Pause' : 'Fly'}
				</button>
				{#each SPEEDS as s (s)}
					<button
						class="btn btn-sm"
						class:btn-primary={kmh === s}
						aria-pressed={kmh === s}
						onclick={() => (kmh = s)}
					>
						{s}
					</button>
				{/each}
				<span class="text-muted">km/h</span>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each CAMERAS as c (c)}
					<button
						class="btn btn-sm"
						class:btn-primary={camera === c}
						aria-pressed={camera === c}
						onclick={() => setCamera(c)}
					>
						{c}
					</button>
				{/each}
			</div>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={share}
					onchange={(e) => {
						share = e.currentTarget.checked;
						void build();
					}}
				/>
				Draw a road ridden twice once (as a ride does)
			</label>

			<svg
				viewBox="{box.x} {box.z} {box.w} {box.h}"
				class="bg-surface-raised aspect-square w-full cursor-crosshair rounded"
				role="presentation"
				onclick={onPlan}
			>
				<polyline
					points={plan}
					fill="none"
					stroke="currentColor"
					stroke-width={box.w / 220}
				/>
				{#each sharedRuns as run, i (i)}
					<polyline
						points={run}
						fill="none"
						stroke="var(--color-neon)"
						stroke-width={box.w / 110}
					/>
				{/each}
				{#each crossings as c, i (i)}
					<circle
						cx={c.x}
						cy={c.z}
						r={box.w / 45}
						fill="none"
						stroke="var(--color-danger, red)"
						stroke-width={box.w / 180}
					/>
				{/each}
				<circle
					cx={here.x}
					cy={here.z}
					r={box.w / 60}
					fill="var(--color-watt)"
				/>
			</svg>
			<svg
				viewBox="0 0 1000 60"
				preserveAspectRatio="none"
				class="bg-surface-raised h-14 w-full cursor-crosshair rounded"
				role="presentation"
				onclick={(e) => {
					const rect = e.currentTarget.getBoundingClientRect();
					seek(((e.clientX - rect.left) / rect.width) * route!.length);
				}}
			>
				<polyline
					points={profile}
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
				/>
				<line
					x1={(m / route.length) * 1000}
					x2={(m / route.length) * 1000}
					y1="0"
					y2="60"
					stroke="var(--color-watt)"
					stroke-width="3"
				/>
			</svg>
			<p class="text-muted">
				Violet: drawn on an earlier pass. Red rings: the route crosses itself.
			</p>

			<h2 class="eyebrow">Crossings ({crossings.length})</h2>
			<ul class="flex flex-col gap-1">
				{#each crossings as c, i (i)}
					<li class="flex items-center gap-2">
						<span
							class="min-w-0 flex-1"
							class:text-ink={i === near}
							class:text-muted={i !== near}
						>
							{i + 1}. {km(c.a)} × {km(c.b)} km · {c.rise >= 0
								? '+'
								: ''}{c.rise.toFixed(1)} m ·
							{Math.round(c.angle)}°
						</span>
						<button class="btn btn-sm" onclick={() => seek(c.a - 80)}
							>1st</button
						>
						<button class="btn btn-sm" onclick={() => seek(c.b - 80)}
							>2nd</button
						>
					</li>
				{:else}
					<li class="text-muted">None.</li>
				{/each}
			</ul>

			<h2 class="eyebrow">Note</h2>
			<textarea
				class="input min-h-20"
				placeholder="What looks wrong here?"
				bind:value={note}></textarea>
			<pre
				class="bg-surface-raised text-muted rounded p-2 text-xs whitespace-pre-wrap">{report}</pre>
			<button class="btn btn-sm" onclick={copy}
				>{copied ? 'Copied' : 'Copy the note'}</button
			>
		{/if}
	</aside>
</div>
