<script module lang="ts">
	export type MarkKind = 'sun' | 'sunset' | 'horizon' | 'tube' | 'chrome';
</script>

<script lang="ts">
	let { kind, size = 64 }: { kind: MarkKind; size?: number } = $props();

	// Gradient/mask ids must be unique — the page renders every mark several times over.
	const uid = $props.id();

	// Sun slices widen toward the bottom: the retro-sun cue, in four rects.
	const slices = [
		{ y: 34, h: 2 },
		{ y: 40, h: 3 },
		{ y: 47, h: 4 },
		{ y: 55, h: 5.5 },
	];

	// Grid converging on a vanishing point just below the horizon.
	const rails = [-44, -22, -2, 14, 32, 50, 66, 86, 108];
	const rungs = [36, 39.5, 44.5, 51.5, 61];

	const wTrace = 'M6 17 L20 47 L32 28 L44 47 L58 17';
</script>

<svg
	viewBox="0 0 64 64"
	width={size}
	height={size}
	fill="none"
	aria-hidden="true"
>
	<defs>
		<linearGradient id="{uid}-sun" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="var(--color-watt)" />
			<stop offset="58%" stop-color="var(--color-neon)" />
			<stop offset="100%" stop-color="var(--color-neon)" stop-opacity="0.35" />
		</linearGradient>
		<linearGradient id="{uid}-chrome" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="var(--color-watt)" />
			<stop offset="100%" stop-color="var(--color-neon)" />
		</linearGradient>
		<mask id="{uid}-slices">
			<rect x="0" y="0" width="64" height="64" fill="white" />
			{#each slices as slice (slice.y)}
				<rect x="0" y={slice.y} width="64" height={slice.h} fill="black" />
			{/each}
		</mask>
		<clipPath id="{uid}-below">
			<rect x="0" y="33" width="64" height="31" />
		</clipPath>
	</defs>

	{#if kind === 'sun'}
		<circle
			cx="32"
			cy="32"
			r="26"
			fill="url(#{uid}-sun)"
			mask="url(#{uid}-slices)"
			class="text-watt glow-stroke"
		/>
	{:else if kind === 'sunset'}
		<circle
			cx="32"
			cy="30"
			r="22"
			fill="url(#{uid}-sun)"
			mask="url(#{uid}-slices)"
		/>
		<path
			d={wTrace}
			stroke="currentColor"
			stroke-width="6"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="text-watt glow-stroke"
		/>
	{:else if kind === 'horizon'}
		<g clip-path="url(#{uid}-below)" class="text-neon" opacity="0.7">
			{#each rails as x (x)}
				<line
					x1={x}
					y1="64"
					x2="32"
					y2="33"
					stroke="currentColor"
					stroke-width="1.2"
				/>
			{/each}
			{#each rungs as y (y)}
				<line
					x1="0"
					y1={y}
					x2="64"
					y2={y}
					stroke="currentColor"
					stroke-width="1.2"
				/>
			{/each}
		</g>
		<path
			d="M6 12 L20 40 L32 22 L44 40 L58 12"
			stroke="currentColor"
			stroke-width="6"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="text-watt glow-stroke"
		/>
	{:else if kind === 'tube'}
		<path
			d={wTrace}
			stroke="var(--color-neon)"
			stroke-width="11"
			stroke-linecap="round"
			stroke-linejoin="round"
			opacity="0.45"
		/>
		<path
			d={wTrace}
			stroke="currentColor"
			stroke-width="5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="text-watt glow-stroke"
		/>
	{:else if kind === 'chrome'}
		<line
			x1="2"
			y1="38"
			x2="62"
			y2="38"
			stroke="var(--color-neon)"
			stroke-width="2"
			opacity="0.6"
		/>
		<path
			d={wTrace}
			stroke="url(#{uid}-chrome)"
			stroke-width="9"
			stroke-linecap="square"
			stroke-linejoin="miter"
			class="text-watt glow-stroke"
		/>
	{/if}
</svg>
