<script lang="ts">
	// Bergpreis on the room's arcade cabinet (arcade.ts): a canvas, one button,
	// and the crew's best five.
	import Modal from '$lib/components/Modal.svelte';
	import { api } from '$lib/api';
	import { rect, text, textWidth } from '$lib/lounge/pixel';
	import { LOUNGE as C } from '$lib/lounge/palette';
	import {
		BAND,
		RUN_SEC,
		bandAt,
		inBand,
		newRun,
		over,
		scoreOf,
		step,
		type Run,
	} from '$lib/lounge/arcade';

	interface Score {
		name: string;
		score: number;
	}

	let {
		crew,
		onclose,
		onscore,
	}: { crew: string; onclose: () => void; onscore: () => void } = $props();

	const W = 160;
	const H = 90;
	let run = $state.raw<Run>(newRun());
	let phase = $state<'ready' | 'riding' | 'done'>('ready');
	let held = false;
	let top = $state<Score[]>([]);

	async function loadTop() {
		const res = await api<{ top: Score[] }>(`/api/crews/${crew}/arcade`);
		if (res.ok) top = res.data.top;
	}
	void loadTop();

	function draw(g: CanvasRenderingContext2D) {
		rect(g, 0, 0, W, H, C.screen);
		const scroll = run.metres * 2;
		// The hill: a road climbing to the right, with posts going by.
		for (let x = 18; x < W; x++) {
			const y = 74 - Math.round((x - 18) * 0.18);
			rect(g, x, y, 1, H - y, C.grid);
			rect(g, x, y, 1, 1, C.lilac);
		}
		for (let i = 0; i < 4; i++) {
			const x = 150 - ((scroll + i * 40) % 132);
			const y = 74 - Math.round((x - 18) * 0.18);
			rect(g, x, y - 6, 1, 6, C.paper);
		}
		// The rider: a bike and someone on it, legs turning with the climb.
		const rx = 52;
		const ry = 74 - Math.round((rx - 18) * 0.18);
		const turn = Math.floor(run.metres) % 2;
		rect(g, rx - 6, ry - 3, 3, 3, C.teal);
		rect(g, rx + 4, ry - 5, 3, 3, C.teal);
		rect(g, rx - 4, ry - 6, 9, 1, C.violet);
		rect(g, rx - 1, ry - 12, 4, 6, C.heart);
		rect(g, rx, ry - 15, 3, 3, C.amber);
		rect(g, rx + turn - 1, ry - 5, 1, 3, C.paper);
		// The meter: the band drifting, the needle held up by the button.
		rect(g, 4, 6, 8, 78, C.ink);
		const y = (v: number) => 83 - Math.round(v * 76);
		const mid = bandAt(run.t);
		const hit = inBand(run);
		rect(
			g,
			5,
			y(mid + BAND / 2),
			6,
			Math.round(BAND * 76),
			hit ? C.teal : C.leaf,
		);
		rect(g, 3, y(run.power), 10, 2, C.paper);
		const score = String(scoreOf(run));
		text(g, score, W - textWidth(score) - 3, 3, C.amber);
		const left = String(Math.ceil(RUN_SEC - run.t));
		text(g, left, 18, 3, C.paper);
	}

	function canvasLoop(canvas: HTMLCanvasElement) {
		const g = canvas.getContext('2d')!;
		let last = performance.now();
		let frame = requestAnimationFrame(function tick(now) {
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			if (phase === 'riding') {
				run = step(run, dt, held);
				if (over(run)) finish();
			}
			draw(g);
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}

	async function finish() {
		phase = 'done';
		held = false;
		await api(`/api/crews/${crew}/arcade`, {
			method: 'POST',
			json: { score: scoreOf(run) },
		});
		await loadTop();
		onscore();
	}

	function begin() {
		run = newRun();
		phase = 'riding';
	}

	function key(e: KeyboardEvent, down: boolean) {
		if (e.code !== 'Space') return;
		e.preventDefault();
		if (phase === 'riding') held = down;
	}
</script>

<svelte:window onkeydown={(e) => key(e, true)} onkeyup={(e) => key(e, false)} />

<Modal label="Bergpreis" {onclose} class="max-w-xl">
	<h2 class="font-display text-lg font-bold">Bergpreis</h2>
	<p class="text-muted mt-1 text-sm">
		Thirty seconds up the hill. Hold to push, let go to ease off, and keep the
		needle in the band.
	</p>
	<button
		type="button"
		aria-label="Hold to push"
		class="mt-3 block w-full touch-none select-none"
		onpointerdown={() => (held = true)}
		onpointerup={() => (held = false)}
		onpointerleave={() => (held = false)}
	>
		<canvas
			width={W}
			height={H}
			{@attach canvasLoop}
			class="w-full rounded [image-rendering:pixelated]"
		></canvas>
	</button>
	<div class="mt-3 flex items-center gap-3">
		{#if phase !== 'riding'}
			<button type="button" onclick={begin} class="btn btn-primary"
				>{phase === 'done' ? 'Ride again' : 'Start'}</button
			>
		{/if}
		{#if phase === 'done'}
			<p class="font-display text-sm font-bold">{scoreOf(run)} points</p>
		{/if}
	</div>
	<h3 class="eyebrow mt-4 mb-1.5">Your crew's best</h3>
	{#if top.length}
		<ol class="grid gap-1 text-sm">
			{#each top as entry, i (entry.name)}
				<li class="flex justify-between gap-3">
					<span class="truncate">{i + 1}. {entry.name}</span>
					<span class="font-display tabular-nums">{entry.score}</span>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="text-muted text-sm">Nobody yet. The hill is yours.</p>
	{/if}
</Modal>
