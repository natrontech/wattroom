<script lang="ts">
	// The landing's one glowing thing (#111, ADR-0005 restraint rule): a
	// session in progress. Zone-colored interval blocks, a watt trace that
	// draws itself, a now-line sweeping the timeline. Pure SVG + CSS — no
	// dependencies, no player, and reduced motion gets the finished picture.

	// A sweet-spot shape, hand-placed for the silhouette — not a real workout,
	// so no product numbers involved.
	const blocks = [
		{ w: 10, h: 28, z: 1 },
		{ w: 8, h: 42, z: 2 },
		{ w: 14, h: 74, z: 4 },
		{ w: 6, h: 38, z: 2 },
		{ w: 14, h: 74, z: 4 },
		{ w: 6, h: 38, z: 2 },
		{ w: 10, h: 88, z: 5 },
		{ w: 4, h: 100, z: 7 },
		{ w: 12, h: 46, z: 3 },
		{ w: 16, h: 24, z: 1 },
	];
	const ZONE = ['', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'];
	let at = 0;
	const rects = blocks.map((b) => {
		const r = { x: at, ...b };
		at += b.w;
		return r;
	});

	// The trace rides the top of the blocks with a little wobble baked in.
	const trace = rects
		.flatMap((r) => {
			const y = 100 - r.h;
			return [
				`${r.x + 1},${y + 3}`,
				`${r.x + r.w / 2},${y - 1}`,
				`${r.x + r.w - 1},${y + 2}`,
			];
		})
		.join(' ');
</script>

<svg
	viewBox="0 0 100 104"
	preserveAspectRatio="none"
	class="hero h-full w-full"
	aria-hidden="true"
>
	{#each rects as r (r.x)}
		<rect
			x={r.x + 0.4}
			y={100 - r.h}
			width={r.w - 0.8}
			height={r.h}
			rx="0.6"
			fill="var(--color-{ZONE[r.z]})"
			opacity="0.55"
		/>
	{/each}
	<polyline
		points={trace}
		fill="none"
		stroke="var(--color-watt)"
		stroke-width="1.1"
		stroke-linejoin="round"
		vector-effect="non-scaling-stroke"
		class="trace"
	/>
	<line
		x1="0"
		y1="0"
		x2="0"
		y2="104"
		stroke="white"
		stroke-width="0.4"
		opacity="0.6"
		class="now"
	/>
</svg>

<style>
	.trace {
		filter: drop-shadow(0 0 4px var(--color-watt));
		stroke-dasharray: 400;
		stroke-dashoffset: 400;
		animation: draw 7s linear infinite;
	}
	.now {
		animation: sweep 7s linear infinite;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes sweep {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(100px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.trace {
			animation: none;
			stroke-dashoffset: 0;
		}
		.now {
			display: none;
		}
	}
</style>
