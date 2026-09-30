<script lang="ts">
	/**
	 * The climb card's profile (#3645): the climb from its foot to the top in
	 * 100 m bars, each in its grade step's fill — the theme's own ramp, never
	 * the zone tokens (#397) — and your dot on it, the only glow.
	 */
	import { HALO } from '$lib/ride/halo';
	import type { ClimbView } from '$lib/ride/climb-view';

	let { view, tv = false }: { view: ClimbView; tv?: boolean } = $props();

	/** Each grade step's fill, gentlest first (app.css, gated in grade-ramp.test.ts). */
	const FILL = [
		'bg-grade-1',
		'bg-grade-2',
		'bg-grade-3',
		'bg-grade-4',
		'bg-grade-5',
	];

	const span = $derived(Math.max(view.hi - view.lo, 1));
	const up = (height: number) => ((height - view.lo) / span) * 100;
	const along = $derived(
		Math.min(
			1,
			Math.max(
				0,
				(view.m - view.climb.startM) / (view.climb.topM - view.climb.startM),
			),
		) * 100,
	);
</script>

<div
	data-testid="climb-profile"
	role="img"
	aria-label="the climb from its foot to the top"
	class="relative mt-3 flex items-end {tv ? 'h-[8vh]' : 'h-16'}"
>
	{#each view.bars as bar, i (i)}
		<span
			class="{FILL[
				bar.step
			]} min-h-px flex-1 rounded-t-sm forced-color-adjust-none forced-colors:bg-[GrayText]"
			style:height="{up(bar.height)}%"
		></span>
	{/each}
	<span
		data-testid="climb-dot"
		class="absolute -translate-x-1/2 translate-y-1/2 rounded-full forced-color-adjust-none forced-colors:bg-[Highlight] {tv
			? 'size-[3vh]'
			: 'size-5'}"
		style:left="{along}%"
		style:bottom="{up(Math.min(Math.max(view.heightNow, view.lo), view.hi))}%"
		style:background-image={HALO}
	></span>
</div>
