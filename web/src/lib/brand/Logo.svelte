<script lang="ts">
	/**
	 * The equalizer W: five bars whose heights trace the letter, so the mark is
	 * literally an interval graph. `live` sets the bars breathing — the mark
	 * doubles as the quietest possible "a session is running" indicator.
	 */
	let {
		size = 32,
		live = false,
		wordmark = false,
	}: { size?: number; live?: boolean; wordmark?: boolean } = $props();

	const uid = $props.id();
	const bars = [46, 20, 34, 20, 46].map((h, i) => ({
		x: 2 + i * 13,
		y: 58 - h,
		h,
	}));
</script>

<span class="inline-flex items-center gap-2.5">
	<svg
		viewBox="0 0 64 64"
		width={size}
		height={size}
		fill="none"
		role="img"
		aria-label="WattRoom"
		class="text-watt glow-stroke {live ? 'live' : ''}"
	>
		<defs>
			<linearGradient id="{uid}-sunset" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="var(--color-watt)" />
				<stop offset="100%" stop-color="var(--color-neon)" />
			</linearGradient>
		</defs>
		{#each bars as bar, i (bar.x)}
			<rect
				x={bar.x}
				y={bar.y}
				width="8"
				height={bar.h}
				rx="4"
				fill="url(#{uid}-sunset)"
				style="--i: {i}"
			/>
		{/each}
	</svg>
	{#if wordmark}
		<span
			class="font-display font-bold tracking-tight text-white"
			style="font-size: {size * 0.62}px">WattRoom</span
		>
	{/if}
</span>

<style>
	.live rect {
		transform-box: fill-box;
		transform-origin: bottom;
		animation: eq 1.1s ease-in-out infinite;
		animation-delay: calc(var(--i, 0) * -0.19s);
	}
	@keyframes eq {
		0%,
		100% {
			transform: scaleY(0.5);
		}
		50% {
			transform: scaleY(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.live rect {
			animation: none;
		}
	}
</style>
