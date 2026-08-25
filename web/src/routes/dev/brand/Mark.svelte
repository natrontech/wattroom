<script module lang="ts">
	export type MarkKind = 'bars' | 'reflect' | 'sundisc' | 'ring' | 'framed';
</script>

<script lang="ts">
	let {
		kind,
		size = 64,
		live = false,
	}: { kind: MarkKind; size?: number; live?: boolean } = $props();

	// Gradient/mask ids must be unique — the page renders every mark several times over.
	const uid = $props.id();

	// The equalizer W: bar heights trace a W valley, so the interval graph is the letter.
	const eq = [46, 20, 34, 20, 46].map((h, i) => ({
		x: 2 + i * 13,
		y: 58 - h,
		h,
	}));

	// Same equalizer, scaled down to sit in front of a setting sun.
	const eqSmall = [32, 14, 24, 14, 32].map((h, i) => ({
		x: 9 + i * 10,
		y: 56 - h,
		h,
	}));

	// Radial equalizer: a room of riders seen from above, one of them live.
	const spokes = [14, 8, 11, 6, 13, 7, 12, 9].map((len, i) => {
		const a = -Math.PI / 2 + (i * Math.PI) / 4;
		return {
			x1: 32 + 14 * Math.cos(a),
			y1: 32 + 14 * Math.sin(a),
			x2: 32 + (14 + len) * Math.cos(a),
			y2: 32 + (14 + len) * Math.sin(a),
		};
	});

	const framed = [22, 12, 18, 28].map((h, i) => ({
		x: 14 + i * 10,
		y: 46 - h,
		h,
	}));
</script>

<svg
	viewBox="0 0 64 64"
	width={size}
	height={size}
	fill="none"
	aria-hidden="true"
	class={live ? 'live' : ''}
>
	<defs>
		<linearGradient id="{uid}-sunset" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="var(--color-watt)" />
			<stop offset="100%" stop-color="var(--color-neon)" />
		</linearGradient>
		<linearGradient id="{uid}-fade" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="var(--color-neon)" stop-opacity="0.55" />
			<stop offset="100%" stop-color="var(--color-neon)" stop-opacity="0" />
		</linearGradient>
		<mask id="{uid}-slices">
			<rect x="0" y="0" width="64" height="64" fill="white" />
			<rect x="0" y="44" width="64" height="3" fill="black" />
			<rect x="0" y="52" width="64" height="4" fill="black" />
		</mask>
	</defs>

	{#if kind === 'bars'}
		<g class="text-watt glow-stroke">
			{#each eq as bar, i (bar.x)}
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
		</g>
	{:else if kind === 'reflect'}
		<g class="text-watt glow-stroke">
			{#each eq as bar, i (bar.x)}
				<rect
					x={bar.x}
					y={bar.y * 0.62 + 4}
					width="8"
					height={bar.h * 0.62}
					rx="4"
					fill="url(#{uid}-sunset)"
					style="--i: {i}"
				/>
			{/each}
		</g>
		<line
			x1="0"
			y1="42"
			x2="64"
			y2="42"
			stroke="var(--color-neon)"
			stroke-width="2"
		/>
		{#each eq as bar (bar.x)}
			<rect
				x={bar.x}
				y="45"
				width="8"
				height={bar.h * 0.3}
				rx="4"
				fill="url(#{uid}-fade)"
			/>
		{/each}
	{:else if kind === 'sundisc'}
		<circle
			cx="32"
			cy="28"
			r="24"
			fill="url(#{uid}-sunset)"
			mask="url(#{uid}-slices)"
			opacity="0.55"
		/>
		<g class="text-watt glow-stroke">
			{#each eqSmall as bar, i (bar.x)}
				<rect
					x={bar.x}
					y={bar.y}
					width="6"
					height={bar.h}
					rx="3"
					fill="currentColor"
					style="--i: {i}"
				/>
			{/each}
		</g>
	{:else if kind === 'ring'}
		<circle
			cx="32"
			cy="32"
			r="9"
			stroke="var(--color-neon)"
			stroke-width="3"
			opacity="0.7"
		/>
		{#each spokes as spoke, i (i)}
			<line
				x1={spoke.x1}
				y1={spoke.y1}
				x2={spoke.x2}
				y2={spoke.y2}
				stroke="currentColor"
				stroke-width="6"
				stroke-linecap="round"
				class={i === 0 ? 'text-watt glow-stroke' : 'text-neon opacity-55'}
			/>
		{/each}
	{:else if kind === 'framed'}
		<rect
			x="6"
			y="6"
			width="52"
			height="52"
			rx="15"
			stroke="var(--color-neon)"
			stroke-width="4"
		/>
		<g class="text-watt glow-stroke">
			{#each framed as bar, i (bar.x)}
				<rect
					x={bar.x}
					y={bar.y}
					width="6"
					height={bar.h}
					rx="3"
					fill="url(#{uid}-sunset)"
					style="--i: {i}"
				/>
			{/each}
		</g>
	{/if}
</svg>

<style>
	/* The mark as a power meter: bars breathe while a ride is running. */
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
