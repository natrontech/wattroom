<script lang="ts">
	/**
	 * The climb card's profile (#3645): the climb from its foot to the top in
	 * 100 m bars, each in its grade step's fill — the theme's own ramp, never
	 * the zone tokens (#397) — and your dot on it, in ink: watt marks your
	 * place once, on the Skyline (TARGETS G2).
	 */
	import type { ClimbView } from '$lib/ride/climb-view';
	import { GRADE_BG } from '$lib/road/skyline';

	let { view, tv = false }: { view: ClimbView; tv?: boolean } = $props();

	// Half the dot: at the foot and the top it stays inside the profile's row.
	const half = $derived(tv ? '1.5vh' : '10px');
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
			class="{GRADE_BG[
				bar.step
			]} min-h-px flex-1 forced-color-adjust-none forced-colors:bg-[GrayText]"
			style:height="{up(bar.height)}%"
		></span>
	{/each}
	<span
		data-testid="climb-dot"
		class="bg-ink border-surface absolute -translate-x-1/2 translate-y-1/2 rounded-full border-2 forced-color-adjust-none forced-colors:bg-[Highlight] {tv
			? 'size-[3vh]'
			: 'size-5'}"
		style:left="clamp({half}, {along}%, calc(100% - {half}))"
		style:bottom="{up(Math.min(Math.max(view.heightNow, view.lo), view.hi))}%"
	></span>
</div>
