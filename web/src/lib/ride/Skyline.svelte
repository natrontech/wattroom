<script lang="ts">
	/**
	 * The Skyline (#3059, ADR-0066): the road ahead in slot 5 — the profile
	 * in five grade steps, the climbs by class where they top out, a road
	 * workout's blocks under it, and your dot. The world's fallback, and the
	 * horizon of every ride on a road.
	 *
	 * Cheap by construction (#2998, PERFORMANCE.md): the road is SVG tiles no
	 * wider than 4096 px, redrawn only when a second arrives; between seconds
	 * a timer at most 10 times a second only moves them, and never a CSS
	 * transition. Below 8 km/h, and for a rider who asked for stillness, they
	 * move once a second. Your dot is the only glow, a halo painted once.
	 */
	import { untrack } from 'svelte';
	import { ZONE_BG } from '$lib/components/zones';
	import { prefersReducedMotion } from '$lib/motion';
	import { heightAt } from '$lib/road/at-metre';
	import { climbsOf } from '$lib/road/climbs';
	import type { Road } from '$lib/road/road';
	import {
		aheadFor,
		bandIn,
		chipsIn,
		createAheadEase,
		frameFor,
		SKYLINE,
		stepsPerTick,
		tileOf,
		tilesIn,
		yOf,
		type BandBlock,
	} from '$lib/road/skyline';

	let {
		road,
		m,
		mps,
		band = [],
		strip = false,
		tv = false,
	}: {
		road: Road;
		/** The dot: metres along the road, as of the last second. */
		m: number;
		/** The dot's speed, m/s. */
		mps: number;
		/** A road workout's blocks, by metre. */
		band?: BandBlock[];
		/** Under a shared screen: a 40 px strip, the profile and the dot alone. */
		strip?: boolean;
		tv?: boolean;
	} = $props();

	/** The dot's halo, painted once: the watt colour fading out, no filter. */
	const HALO =
		'radial-gradient(circle, var(--color-watt) 0 28%, color-mix(in oklab, var(--color-watt) 35%, transparent) 42%, transparent 70%)';

	/** Each grade step's fill, gentlest first (app.css, gated in grade-ramp.test.ts). */
	const FILL = [
		'fill-grade-1',
		'fill-grade-2',
		'fill-grade-3',
		'fill-grade-4',
		'fill-grade-5',
	];

	let width = $state(0);
	let height = $state(0);
	const climbs = $derived(climbsOf(road));
	const perTick = $derived(stepsPerTick(mps, prefersReducedMotion.current));

	// The reach ahead eases with the speed, a second at a time.
	const ease = createAheadEase(untrack(() => aheadFor(mps)));
	let ahead = $state(untrack(() => aheadFor(mps)));
	let secondAt = performance.now();
	let now = $state(performance.now());
	$effect(() => {
		// A new second: where the dot is, and how far ahead to look.
		void m;
		const at = performance.now();
		ahead = ease.step(
			aheadFor(untrack(() => mps)),
			Math.min(2, (at - secondAt) / 1000),
		);
		secondAt = at;
		now = at;
	});
	$effect(() => {
		if (perTick) return;
		const id = setInterval(
			() => (now = performance.now()),
			1000 / SKYLINE.stepHz,
		);
		return () => clearInterval(id);
	});

	// Redrawn once a second; moved between.
	const frame = $derived(
		width && height ? frameFor(road, m, ahead, width, height) : null,
	);
	const tiles = $derived(
		frame
			? tilesIn(frame, road, Math.max(0, mps)).map((i) =>
					tileOf(frame, road, i),
				)
			: [],
	);
	const chips = $derived(frame && !strip ? chipsIn(frame, road, climbs) : []);
	const blocks = $derived(frame && !strip ? bandIn(frame, band) : []);
	/** Where the dot is now: the last second, carried on at its speed. */
	const shown = $derived(
		perTick
			? m
			: Math.min(road.length, m + mps * Math.min(1, (now - secondAt) / 1000)),
	);
	const shift = $derived(frame ? (shown - SKYLINE.behindM) * frame.scale : 0);
	const dot = $derived(
		frame
			? {
					x: SKYLINE.behindM * frame.scale,
					y: yOf(frame, heightAt(road, shown)),
				}
			: null,
	);
</script>

<div
	bind:clientWidth={width}
	bind:clientHeight={height}
	data-testid="skyline"
	role="img"
	aria-label="the road ahead: {((road.length - m) / 1000).toFixed(1)} km to go"
	class="relative h-full w-full overflow-hidden"
>
	{#if frame}
		<div
			class="absolute inset-y-0 left-0 will-change-transform"
			style:transform="translateX({-shift}px)"
		>
			{#each tiles as tile (tile.index)}
				<svg
					width={tile.width}
					{height}
					style:left="{tile.left}px"
					class="absolute top-0 overflow-visible forced-color-adjust-none"
					aria-hidden="true"
				>
					{#each tile.areas as area, step (step)}
						{#if area}<path
								d={area}
								class="{FILL[step]} forced-colors:fill-[GrayText]"
							/>{/if}
					{/each}
					<path
						d={tile.line}
						fill="none"
						class="stroke-neon forced-colors:stroke-[CanvasText]"
						stroke-width={tv ? 3 : 2}
					/>
				</svg>
			{/each}
			{#each blocks as block, i (i)}
				<span
					class="{ZONE_BG[block.zone]} absolute bottom-0 h-1.5"
					style:left="{block.x}px"
					style:width="{block.width}px"
				></span>
			{/each}
			{#each chips as chip, i (i)}
				<span
					class="border-neon bg-surface text-ink absolute -mt-1 -translate-x-1/2 -translate-y-full rounded border px-1 leading-none font-bold {tv
						? 'text-[3vh]'
						: 'text-sm'}"
					style:left="{chip.x}px"
					style:top="{chip.y}px">{chip.cls}</span
				>
			{/each}
		</div>
		{#if dot}
			<!-- The only glow: a halo painted once, never a filter (#2998). -->
			<span
				data-testid="skyline-dot"
				class="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 rounded-full will-change-transform forced-color-adjust-none forced-colors:bg-[Highlight] {tv
					? 'size-[4vh]'
					: 'size-6'}"
				style:transform="translate({dot.x}px, {dot.y}px)"
				style:background-image={HALO}
			></span>
		{/if}
	{/if}
</div>
