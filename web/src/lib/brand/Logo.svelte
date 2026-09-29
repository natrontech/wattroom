<script lang="ts">
	/**
	 * The equalizer W: five bars whose heights trace the letter, so the mark is
	 * literally an interval graph. `live` sets the bars breathing — the mark
	 * doubles as the quietest possible "a session is running" indicator.
	 *
	 * Spans, not SVG, and the glow on each bar, never on the mark (#2998): a
	 * filter over animated content is blurred again on every frame, and an
	 * SVG transform animation is not reliably composited. As spans, each bar
	 * and its halo are drawn once and the compositor only scales them.
	 */
	let {
		size = 32,
		live = false,
		wordmark = false,
	}: { size?: number; live?: boolean; wordmark?: boolean } = $props();

	// The letter on a 64-unit grid, as percentages of the mark's box.
	const unit = (n: number) => `${(n / 64) * 100}%`;
	const bars = [46, 20, 34, 20, 46].map((h, i) => ({
		left: unit(2 + i * 13),
		top: unit(58 - h),
		height: unit(h),
	}));
</script>

<span class="inline-flex items-center gap-2.5">
	<span
		role="img"
		aria-label="WattRoom"
		class="text-watt relative shrink-0 {live ? 'live' : ''}"
		style="width: {size}px; height: {size}px"
	>
		{#each bars as bar, i (bar.left)}
			<span
				class="bar absolute rounded-full {live ? 'glow-stroke' : ''}"
				style="left: {bar.left}; top: {bar.top}; width: {unit(
					8,
				)}; height: {bar.height}; --i: {i}"
			></span>
		{/each}
	</span>
	{#if wordmark}
		<span
			class="font-display text-ink font-bold tracking-tight"
			style="font-size: {size * 0.62}px">WattRoom</span
		>
	{/if}
</span>

<style>
	.bar {
		background: linear-gradient(var(--color-watt), var(--color-neon));
	}
	/* app.css's stepped `equalizer` (#3199). */
	.live .bar {
		--eq-low: 0.5;
		transform-origin: bottom;
		animation: equalizer 1.1s step-end infinite;
		animation-delay: calc(var(--i, 0) * -0.19s);
	}
	@media (prefers-reduced-motion: reduce) {
		.live .bar {
			animation: none;
		}
	}
</style>
